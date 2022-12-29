import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Blockchain, Collection, Owner, Token, Transaction, Domain } from "../generated/schema";
import { Transfer } from "../generated/Arts/ERC721";
import { AddressChanged, NameMigrated, NameRegistered } from "../generated/DoidRegistry/DoidRegistry";
import { toBigDecimal } from "./utils/helpers";
import { fetchName, fetchSymbol, fetchTokenURI } from "./utils/eip721";

export function handleTransfer(event: Transfer): void {
  let blockchain = Blockchain.load("DOID");
  if (blockchain === null) {
    // Blockchain
    blockchain = new Blockchain("DOID");
    blockchain.totalCollections = BigInt.zero();
    blockchain.totalTokens = BigInt.zero();
    blockchain.totalTransactions = BigInt.zero();
    blockchain.save();
  }
  blockchain.totalTransactions = blockchain.totalTransactions.plus(BigInt.fromI32(1));
  blockchain.save();

  let collection = Collection.load(event.address.toHex());
  if (collection === null) {
    // Collection
    collection = new Collection(event.address.toHex());
    collection.name = fetchName(event.address);
    collection.symbol = fetchSymbol(event.address);
    collection.totalTokens = BigInt.zero();
    collection.totalTransactions = BigInt.zero();
    collection.block = event.block.number;
    collection.createdAt = event.block.timestamp;
    collection.updatedAt = event.block.timestamp;
    collection.save();

    // Blockchain
    blockchain.totalCollections = blockchain.totalCollections.plus(BigInt.fromI32(1));
    blockchain.save();
  }
  collection.totalTransactions = collection.totalTransactions.plus(BigInt.fromI32(1));
  collection.updatedAt = event.block.timestamp;
  if (event.params.to.equals(Address.zero())){
    collection.totalTokens = collection.totalTokens.minus(BigInt.fromI32(1));
  }
  collection.save();

  let from = Owner.load(event.params.from.toHex());
  if (from === null) {
    // Owner - as Sender
    from = new Owner(event.params.from.toHex());
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
    token.collection = collection.id;
    token.tokenID = event.params.tokenId;
    token.tokenURI = fetchTokenURI(event.address, event.params.tokenId);
    token.minter = to.id;
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

    // Collection
    collection.totalTokens = collection.totalTokens.plus(BigInt.fromI32(1));
    collection.save();

    // Blockchain
    blockchain.totalTokens = blockchain.totalTokens.plus(BigInt.fromI32(1));
    blockchain.save();
  }
  token.owner = to.id;
  token.burned = event.params.to.equals(Address.zero());
  token.totalTransactions = token.totalTransactions.plus(BigInt.fromI32(1));
  token.updatedAt = event.block.timestamp;
  token.save();

  // Transaction
  const transaction = new Transaction(event.transaction.hash.toHex());
  transaction.hash = event.transaction.hash;
  transaction.from = from.id;
  transaction.to = to.id;
  transaction.collection = collection.id;
  transaction.token = token.id;
  transaction.gasLimit = event.transaction.gasLimit;
  transaction.gasPrice = toBigDecimal(event.transaction.gasPrice, 9);
  transaction.block = event.block.number;
  transaction.timestamp = event.block.timestamp;
  transaction.save();
}

export function handleNameRegistered(event: NameRegistered): void {
  let domain = new Domain(event.params.id.toHexString())
  domain.owner = event.params.owner.toHexString()
  domain.address = event.params.owner.toHexString()
  domain.name = event.params.name.toString()
  domain.coinType = BigInt.fromI32(60)
  domain.createdAt = event.block.timestamp
  domain.blockNumber = event.block.number
  domain.save()
}

export function handleAddressChanged(event: AddressChanged): void {
  let node = event.params.node
  let domain = Domain.load(node.toHexString())
  if(domain == null){
    return
  }
  domain.address = event.params.newAddress.toHexString()
  domain.coinType = event.params.coinType
  domain.save()
}