import { Address, ethereum, store, log, BigInt, dataSource } from "@graphprotocol/graph-ts";
import { Blockchain, Contract, TokenHolder, Owner, Token, Transaction, DOID } from "../generated/schema";
import { Transfer } from "../generated/Arts/ERC721";
import { AddressChanged, NameRegistered } from "../generated/DoidRegistry/DoidRegistry";
import { toBigDecimal } from "./utils/helpers";
import { fetchName, fetchSymbol, fetchTokenURI } from "./utils/eip721";

const BIG0 = BigInt.zero();
const BIG1 = BigInt.fromI32(1);
const COINTYPE_ETH = BigInt.fromI32(60);

const KNOWN_MINTERS = new Map<string, string>();
  if (dataSource.network() == "goerli") {
    // DOID
    KNOWN_MINTERS.set(
      "0xf32950cf48c10431b27eff888d23cb31615dfcb4",
      "0xafb2e1145f1a88ce489d22425ac84003fe50b3be"
    );
    KNOWN_MINTERS.set(
      "0xab4d8acb8538e7f2b81a8e0db6530bbec96678b5",
      "0xafb2e1145f1a88ce489d22425ac84003fe50b3be"
    );
    // TOKYO PUNKS
    KNOWN_MINTERS.set(
      "0x59a498d8cb5f0028591c865c44f55e30b76c9611",
      "0x02eb75be1e72e988de64f0088d654d8ea1081e87"
    );
  } else {
    // DOID
    KNOWN_MINTERS.set(
      "0xcb9302da98405ecc50b1d6d4f9671f05e143b5f7",
      "0xf446563d6737df28d0fde28c82ce4f34e98540f3"
    );
    KNOWN_MINTERS.set(
      "0x8b2aff81fec4e7787aeeb257b5d99626651ee43f",
      "0xf446563d6737df28d0fde28c82ce4f34e98540f3"
    );
  }

function knownMinter(contract: Address): string | null {
  if (KNOWN_MINTERS.has(contract.toHex()))
    return KNOWN_MINTERS.get(contract.toHex());

  return null;
}

function loadOrNewOwner(address: string, block: ethereum.Block): Owner {
  let owner = Owner.load(address);
  if (owner === null) {
    owner = new Owner(address);
    owner.totalTokens = BIG0;
    owner.totalTokensMinted = BIG0;
    owner.totalTokenHolders = BIG0;
    owner.totalTransactions = BIG0;
    owner.block = block.number;
    owner.createdAt = block.timestamp;
    owner.updatedAt = block.timestamp;
    owner.save();
  }
  return owner;
}

function loadOrNewTokenHolder(minter: string, holder: string, block: ethereum.Block): TokenHolder {
  let tokenHolder = TokenHolder.load(minter + "-" + holder);
  if (tokenHolder === null) {
    tokenHolder = new TokenHolder(minter + "-" + holder);
    tokenHolder.save();
    let m = loadOrNewOwner(minter, block);
    m.totalTokenHolders = m.totalTokenHolders.plus(BIG1);
    m.save();
  }
  return tokenHolder;
}

export function handleTransfer(event: Transfer): void {
  let blockchain = Blockchain.load("DOID");
  if (blockchain === null) {
    // Blockchain
    blockchain = new Blockchain("DOID");
    blockchain.totalContracts = BigInt.zero();
    blockchain.totalTokens = BigInt.zero();
    blockchain.totalTransactions = BigInt.zero();
    blockchain.save();
  }
  blockchain.totalTransactions = blockchain.totalTransactions.plus(BigInt.fromI32(1));
  blockchain.save();

  let contract = Contract.load(event.address.toHex());
  if (contract === null) {
    // Contract
    contract = new Contract(event.address.toHex());
    contract.name = fetchName(event.address);
    contract.symbol = fetchSymbol(event.address);
    contract.totalTokens = BigInt.zero();
    contract.totalTransactions = BigInt.zero();
    contract.block = event.block.number;
    contract.createdAt = event.block.timestamp;
    contract.updatedAt = event.block.timestamp;
    contract.save();

    // Blockchain
    blockchain.totalContracts = blockchain.totalContracts.plus(BigInt.fromI32(1));
    blockchain.save();
  }

  // Skip 721s without contract name.
  if (contract.name === "unknown") 
    return;
  
  contract.totalTransactions = contract.totalTransactions.plus(BigInt.fromI32(1));
  contract.updatedAt = event.block.timestamp;
  if (event.params.to.equals(Address.zero())){
    contract.totalTokens = contract.totalTokens.minus(BigInt.fromI32(1));
  }
  contract.save();

  let from = loadOrNewOwner(event.params.from.toHex(), event.block);
  from.totalTokens = event.params.from.equals(Address.zero())
    ? from.totalTokens
    : from.totalTokens.minus(BigInt.fromI32(1));
  from.totalTransactions = from.totalTransactions.plus(BigInt.fromI32(1));
  from.updatedAt = event.block.timestamp;
  from.save();

  let to = loadOrNewOwner(event.params.to.toHex(), event.block);
  to.totalTokens = to.totalTokens.plus(BigInt.fromI32(1));
  to.totalTransactions = to.totalTransactions.plus(BigInt.fromI32(1));
  to.updatedAt = event.block.timestamp;
  to.save();

  let token = Token.load(event.address.toHex() + "-" + event.params.tokenId.toString());
  if (token === null) {
    // Token
    token = new Token(event.address.toHex() + "-" + event.params.tokenId.toString());
    token.contract = contract.id;
    token.tokenID = event.params.tokenId;
    token.tokenURI = fetchTokenURI(event.address, event.params.tokenId);
    token.minter =
      knownMinter(event.address) || event.params.from.equals(Address.zero())
        ? to.id
        : from.id;
    token.owner = to.id;
    token.burned = false;
    token.totalTransactions = BigInt.zero();
    token.block = event.block.number;
    token.createdAt = event.block.timestamp;
    token.updatedAt = event.block.timestamp;
    token.save();

    // token holders
    let minter = loadOrNewOwner(token.minter, event.block);
    minter.totalTokensMinted = minter.totalTokensMinted.plus(BigInt.fromI32(1));
    minter.save();

    // Contract
    contract.totalTokens = contract.totalTokens.plus(BigInt.fromI32(1));
    contract.save();

    // Blockchain
    blockchain.totalTokens = blockchain.totalTokens.plus(BigInt.fromI32(1));
    blockchain.save();
  }
  token.owner = to.id;
  token.burned = event.params.to.equals(Address.zero());
  token.totalTransactions = token.totalTransactions.plus(BigInt.fromI32(1));
  token.updatedAt = event.block.timestamp;
  token.save();

  // Update TokenHolder for old owner if not minting.
  if (!event.params.from.equals(Address.zero())) {
    let holder = loadOrNewTokenHolder(token.minter.toString(), from.id, event.block);
    let index = holder.tokens.indexOf(token.id);
    log.debug('TokenHolder:try remove token:{} from {}(size:{}) at index:{}', [token.id, holder.id, holder.tokens.length.toString(), index.toString()]);
    if (index != -1) {
      if (holder.tokens.length == 1) {
        store.remove("TokenHolder", holder.id);
        from.totalTokenHolders = from.totalTokenHolders.minus(BIG1);
        from.save();
        log.debug('TokenHolder:last holding, remove {}', [holder.id]);
      } else {
        holder.tokens[index] = holder.tokens.pop();
        holder.save();
        log.debug('TokenHolder:{} now size:{}', [holder.id, holder.tokens.length.toString()]);
      }
    }
  }

  // Update TokenHolder for new owner if not burning.
  if (!event.params.to.equals(Address.zero())) {
    let holder = loadOrNewTokenHolder(token.minter.toString(), to.id, event.block);
    log.debug('TokenHolder:try add token:{} to {}(size:{})', [token.id, holder.id, holder.tokens.length.toString()]);
    if (holder.tokens.indexOf(token.id) == -1) {
      holder.tokens.push(token.id);
      holder.save();
      log.debug('TokenHolder:{} now size:{}', [holder.id, holder.tokens.length.toString()]);
    }
  }

  // Transaction
  const transaction = new Transaction(event.transaction.hash.toHex());
  transaction.hash = event.transaction.hash;
  transaction.from = from.id;
  transaction.to = to.id;
  transaction.contract = contract.id;
  transaction.token = token.id;
  transaction.gasLimit = event.transaction.gasLimit;
  transaction.gasPrice = toBigDecimal(event.transaction.gasPrice, 9);
  transaction.block = event.block.number;
  transaction.timestamp = event.block.timestamp;
  transaction.save();
}

export function handleNameRegistered(event: NameRegistered): void {
  let doid = new DOID(event.params.id.toHexString())
  doid.owner = event.params.owner.toHexString()
  doid.address = event.params.owner.toHexString()
  doid.name = event.params.name.toString()
  doid.coinType = BigInt.fromI32(60)
  doid.createdAt = event.block.timestamp
  doid.blockNumber = event.block.number
  doid.save()
}

export function handleAddressChanged(event: AddressChanged): void {
  let node = event.params.node
  let doid = DOID.load(node.toHexString())
  if(doid == null){
    return
  }
  doid.address = event.params.newAddress.toHexString()
  doid.coinType = event.params.coinType
  doid.save()
}