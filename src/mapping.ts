import { Address, log, BigInt } from "@graphprotocol/graph-ts";
import { Blockchain, Contract, Owner, Token, Transaction, DOID } from "../generated/schema";
import { Transfer } from "../generated/Arts/ERC721";
import { AddressChanged, NameRegistered } from "../generated/DoidRegistry/DoidRegistry";
import { toBigDecimal } from "./utils/helpers";
import { fetchName, fetchSymbol, fetchTokenURI } from "./utils/eip721";

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
  contract.totalTransactions = contract.totalTransactions.plus(BigInt.fromI32(1));
  contract.updatedAt = event.block.timestamp;
  if (event.params.to.equals(Address.zero())){
    contract.totalTokens = contract.totalTokens.minus(BigInt.fromI32(1));
  }
  contract.save();

  let from = Owner.load(event.params.from.toHex());
  if (from === null) {
    // Owner - as Sender
    from = new Owner(event.params.from.toHex());
    from.totalTokenHolders = BigInt.zero();
    from.tokenHolders = new Array();
    from.tokenHoldersNumber = new Array();
    from.totalTokens = BigInt.zero();
    from.totalTokensMinted = BigInt.zero();
    from.totalTransactions = BigInt.zero();
    from.block = event.block.number;
    from.createdAt = event.block.timestamp;
    from.updatedAt = event.block.timestamp;
    from.save();
  }
  from.totalTokens = event.params.from.equals(Address.zero())
    ? from.totalTokens
    : from.totalTokens.minus(BigInt.fromI32(1));
  from.totalTransactions = from.totalTransactions.plus(BigInt.fromI32(1));
  from.updatedAt = event.block.timestamp;
  from.save();

  let to = Owner.load(event.params.to.toHex());
  if (to === null) {
    // Owner - as Receiver
    to = new Owner(event.params.to.toHex());
    to.totalTokenHolders = BigInt.zero();
    to.tokenHolders = new Array();
    to.tokenHoldersNumber = new Array();
    to.totalTokens = BigInt.zero();
    to.totalTokensMinted = BigInt.zero();
    to.totalTransactions = BigInt.zero();
    to.block = event.block.number;
    to.createdAt = event.block.timestamp;
    to.updatedAt = event.block.timestamp;
    to.save();
  }
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
    token.minter = event.params.from.equals(Address.zero())
    ? to.id
    : from.id;
    token.owner = to.id;
    token.burned = false;
    token.totalTransactions = BigInt.zero();
    token.block = event.block.number;
    token.createdAt = event.block.timestamp;
    token.updatedAt = event.block.timestamp;
    token.save();

    // Owner - as Receiver
    to.totalTokensMinted = to.totalTokensMinted.plus(BigInt.fromI32(1));
    to.save();

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

  // token holders
  let minter = Owner.load(token.minter);
  if (minter == null){
    minter = new Owner(token.minter);
    minter.totalTokenHolders = BigInt.zero();
    minter.tokenHolders = new Array();
    minter.tokenHoldersNumber = new Array();
    minter.save();
  }
  let index = 0;
  let holderExists = false;
  let holdersNumber = minter.tokenHolders.length
  for (; index < holdersNumber; index++) {
    const holder = minter.tokenHolders[index];
    if(event.params.to.toHex() == holder ){ // mint to an exist address
      holderExists = true;
      break;
    }
  }
  if(holderExists){
    minter.tokenHoldersNumber[index].plus(BigInt.fromI32(1));
  }else{
    minter.tokenHolders.push(to.id);
    minter.tokenHoldersNumber.push(BigInt.fromI32(1));
  }
  if(event.params.from == Address.zero()){
    minter.totalTokenHolders.plus(BigInt.fromI32(1));
  }else if(event.params.to == Address.zero() && minter.totalTokenHolders > BigInt.fromI32(0)){
    minter.totalTokenHolders.minus(BigInt.fromI32(1));
  }else if(holdersNumber > 0 && minter.tokenHoldersNumber[index] == BigInt.fromI32(1)){
    minter.tokenHolders.splice(index, 1);
    minter.tokenHoldersNumber.splice(index, 1);
  }else if(holdersNumber > 0 && minter.tokenHoldersNumber[index] > BigInt.fromI32(1)){
    minter.tokenHoldersNumber[index].minus(BigInt.fromI32(1));
  }
  log.debug('Update minter:{},index:{},exists:{},num:{}', [minter.id, index.toString(), holderExists.toString(), minter.tokenHoldersNumber.toString()]);

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