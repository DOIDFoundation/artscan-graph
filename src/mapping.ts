import { Address, ethereum, store, log, BigInt, dataSource } from "@graphprotocol/graph-ts";
import { Blockchain, Contract, Owner, Token, Transaction, DOID, TokenMinterHolder, MinterHolder } from "../generated/schema";
import { Transfer } from "../generated/Arts/ERC721";
import { AddressChanged, NameRegistered } from "../generated/DoidRegistry/DoidRegistry";
import { toBigDecimal } from "./utils/helpers";
import { fetchName, fetchSymbol, fetchTokenURI } from "./utils/eip721";

const BIG0 = BigInt.zero();
const BIG1 = BigInt.fromI32(1);
const COINTYPE_ETH = BigInt.fromI32(60);

var KNOWN_MINTERS = new Map<string, string>();
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
  // TOKYO PUNKS
  KNOWN_MINTERS.set(
    "0x59a498d8cb5f0028591c865c44f55e30b76c9611",
    "0x02eb75be1e72e988de64f0088d654d8ea1081e87"
  );
}

log.info("network {} has {} known minters", [
  dataSource.network(),
  KNOWN_MINTERS.size.toString(),
]);

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
    let minterHolderId = token.minter + "-" + from.id;
    let tokenMinterHolder = TokenMinterHolder.load(
      token.id + "-" + minterHolderId
    );
    if (tokenMinterHolder != null) {
      log.debug("Holders: remove TokenMinterHolder {}", [tokenMinterHolder.id]);
      store.remove("TokenMinterHolder", tokenMinterHolder.id);
      let minterHolder = MinterHolder.load(minterHolderId);
      if (minterHolder != null) {
        if (!minterHolder.totalTokens.equals(BIG1)) {
          minterHolder.totalTokens = minterHolder.totalTokens.minus(BIG1);
          minterHolder.save();
          log.debug("Holders: MinterHolder {} now have {} tokens", [
            minterHolder.id,
            minterHolder.totalTokens.toString(),
          ]);
        } else {
          log.debug("Holders: remove MinterHolder {}", [minterHolder.id]);
          store.remove("MinterHolder", minterHolder.id);
          let minter = Owner.load(token.minter);
          if (minter != null) {
            minter.totalTokenHolders = minter.totalTokenHolders.minus(BIG1);
            minter.save();
          } else {
            log.error(
              "Holders: TokenMinterHolder found but Minter not found for {}",
              [tokenMinterHolder.id]
            );
          }
        }
      } else {
        log.error(
          "Holders: TokenMinterHolder found but MinterHolder not found for {}",
          [tokenMinterHolder.id]
        );
      }
    }
  }

  // Update TokenHolder for new owner if not burning.
  if (!event.params.to.equals(Address.zero())) {
    let minterHolderId = token.minter + "-" + to.id;
    let minterHolder = MinterHolder.load(minterHolderId);
    if (minterHolder === null) {
      minterHolder = new MinterHolder(minterHolderId);
      minterHolder.minter = token.minter;
      minterHolder.holder = to.id;
      minterHolder.totalTokens = BIG0;
      minterHolder.save();
      let minter = Owner.load(token.minter);
      if (minter != null) {
        minter.totalTokenHolders = minter.totalTokenHolders.plus(BIG1);
        minter.save();
      } else {
        log.error("Holders: MinterHolder created but Minter not found for {}", [
          minterHolder.id,
        ]);
      }
      log.debug("Holders: create MinterHolder {}", [minterHolder.id]);
    }
    let tokenMinterHolder = TokenMinterHolder.load(
      token.id + "-" + minterHolderId
    );
    if (tokenMinterHolder === null) {
      tokenMinterHolder = new TokenMinterHolder(
        token.id + "-" + minterHolderId
      );
      tokenMinterHolder.token = token.id;
      tokenMinterHolder.minterHolder = minterHolderId;
      tokenMinterHolder.save();
      minterHolder.totalTokens = minterHolder.totalTokens.plus(BIG1);
      minterHolder.save();
      log.debug("Holders: create TokenMinterHolder {}", [tokenMinterHolder.id]);
    }
    log.debug("Holders: MinterHolder {} now holds {} tokens", [
      minterHolder.id,
      minterHolder.totalTokens.toString(),
    ]);
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