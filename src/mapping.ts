import { Address, ethereum, ipfs, json, BigInt } from "@graphprotocol/graph-ts";
import { Blockchain, Contract, Owner, Token, Transaction, DOID, Collection } from "../generated/schema";
import { Transfer } from "../generated/Arts/ERC721";
import { AddressChanged, NameRegistered } from "../generated/DoidRegistry/DoidRegistry";
import { toBigDecimal } from "./utils/helpers";
import { fetchName, fetchSymbol, fetchTokenURI } from "./utils/eip721";
import { RegExp } from "assemblyscript-regex";

const BIG0 = BigInt.zero();
const BIG1 = BigInt.fromI32(1);
const COINTYPE_ETH = BigInt.fromI32(60);

function slugify(input: string): string {
  // Replace special characters with space
  input = input.toLowerCase();
  var ret: string[] = [];
  for (let index = 0; index < input.length; index++) {
    var charCode = input.charCodeAt(index);
    if (
      (charCode >= 32 && charCode <= 47) || //' !"#$%&'()*+,-./'
      (charCode >= 58 && charCode <= 64) || //':;<=>?@'
      charCode == 91 || //'['
      (charCode >= 93 && charCode <= 96) || //']^_`'
      (charCode >= 123 && charCode <= 126) //'{|}~'
    ) {
      ret.push(" ");
    } else ret.push(input.charAt(index));
  }
  input = ret.join("").trim();
  // Replace spaces with '-'
  ret = [];
  var lastCharIsWhitespaceCharacters = false;
  for (let index = 0; index < input.length; index++) {
    let c = input.charAt(index);
    if (
      c == " " ||
      c == "\t" ||
      c == "\r" ||
      c == "\n" ||
      c == "\v" ||
      c == "\f"
    ) {
      if (!lastCharIsWhitespaceCharacters) ret.push("-");
      lastCharIsWhitespaceCharacters = true;
    } else {
      ret.push(c);
      lastCharIsWhitespaceCharacters = false;
    }
  }
  return ret.join("");
}

function slugAndIdFromToken(token: Token, contract: Contract): string[] | null {
  let nameString: string;
  if (token.isMetaIPFS && token.name) {
    nameString = token.name!;
  } else if (contract.name) {
    nameString = contract.name;
  } else {
    return null;
  }
  var regex: RegExp = new RegExp("^(.*?)[ #](\\d*)$");
  var result = regex.exec(nameString);
  if (result) {
    nameString = result.matches[1];
  }
  return [
    slugify(nameString),
    result ? result.matches[2] : token.tokenID.toString(),
  ];
}

function loadOrNewOwner(address: string, block: ethereum.Block): Owner {
  let owner = Owner.load(address);
  if (owner === null) {
    owner = new Owner(address);
    owner.totalTokens = BIG0;
    owner.totalTokensMinted = BIG0;
    owner.totalTransactions = BIG0;
    owner.block = block.number;
    owner.createdAt = block.timestamp;
    owner.updatedAt = block.timestamp;
    owner.save();
  }
  return owner;
}

function loadOrNewCollection(id: string, block: ethereum.Block): Collection {
  let collection = Collection.load(id);
  if (collection === null) {
    collection = new Collection(id);
    collection.totalTokens = BIG0;
    collection.block = block.number;
    collection.createdAt = block.timestamp;
    collection.updatedAt = block.timestamp;
    collection.save();
  }
  return collection;
}

export function handleTransfer(event: Transfer): void {
  let blockchain = Blockchain.load("DOID");
  if (blockchain === null) {
    // Blockchain
    blockchain = new Blockchain("DOID");
    blockchain.totalContracts = BIG0;
    blockchain.totalTokens = BIG0;
    blockchain.totalTransactions = BIG0;
    blockchain.save();
  }
  blockchain.totalTransactions = blockchain.totalTransactions.plus(BIG1);
  blockchain.save();

  let from = loadOrNewOwner(event.params.from.toHex(), event.block);
  from.totalTokens = event.params.from.equals(Address.zero())
    ? from.totalTokens
    : from.totalTokens.minus(BIG1);
  from.totalTransactions = from.totalTransactions.plus(BIG1);
  from.updatedAt = event.block.timestamp;
  from.save();

  let contract = Contract.load(event.address.toHex());
  if (contract === null) {
    // Contract
    contract = new Contract(event.address.toHex());
    contract.name = fetchName(event.address);
    contract.symbol = fetchSymbol(event.address);
    contract.creator = from.id;
    contract.creatorIsArtist =
      contract.creator != "0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0" &&
      contract.creator != "0x48cef95fd927fdd5b17fdcbf2af8e82f4c064077";
    contract.totalTokens = BIG0;
    contract.totalTransactions = BIG0;
    contract.block = event.block.number;
    contract.createdAt = event.block.timestamp;
    contract.updatedAt = event.block.timestamp;
    contract.save();

    // Blockchain
    blockchain.totalContracts = blockchain.totalContracts.plus(BIG1);
    blockchain.save();
  }
  contract.totalTransactions = contract.totalTransactions.plus(BIG1);
  contract.updatedAt = event.block.timestamp;
  if (event.params.to.equals(Address.zero())) {
    contract.totalTokens = contract.totalTokens.minus(BIG1);
  }
  contract.save();

  let to = loadOrNewOwner(event.params.to.toHex(), event.block);
  to.totalTokens = to.totalTokens.plus(BIG1);
  to.totalTransactions = to.totalTransactions.plus(BIG1);
  to.updatedAt = event.block.timestamp;
  to.save();

  let token = Token.load(
    event.address.toHex() + "-" + event.params.tokenId.toString()
  );
  if (token === null) {
    // Token
    token = new Token(
      event.address.toHex() + "-" + event.params.tokenId.toString()
    );
    token.contract = contract.id;
    token.tokenID = event.params.tokenId;
    token.tokenURI = fetchTokenURI(event.address, event.params.tokenId);
    if (token.tokenURI != null && token.tokenURI.startsWith("ipfs://")) {
      token.isMetaIPFS = true;
      let metadata = ipfs.cat(token.tokenURI.replace("ipfs://", "/"));
      if (metadata) {
        const value = json.fromBytes(metadata).toObject();
        if (value) {
          const image = value.get("image");
          if (image) {
            token.image = image.toString();
          }
          const name = value.get("name");
          if (name) {
            token.name = name.toString();
          }
          const description = value.get("description");
          if (description) {
            token.description = description.toString();
          }
        }
      }
    }
    let artist = contract.creatorIsArtist
      ? loadOrNewOwner(contract.creator, event.block)
      : event.params.from.equals(Address.zero())
      ? to
      : from;
    token.artist = artist.id;
    let ret= slugAndIdFromToken(token, contract);
    if (ret) {
      let collection = loadOrNewCollection(ret[0], event.block);
      token.collection = collection.id;
      token.collectionId = ret[1];

      // Collection
      collection.totalTokens = collection.totalTokens.plus(BIG1);
      collection.save();
    }
    token.owner = to.id;
    token.burned = false;
    token.totalTransactions = BIG0;
    token.block = event.block.number;
    token.createdAt = event.block.timestamp;
    token.updatedAt = event.block.timestamp;
    token.save();

    // Artist
    artist.totalTokensMinted = artist.totalTokensMinted.plus(BIG1);
    artist.save();

    // Contract
    contract.totalTokens = contract.totalTokens.plus(BIG1);
    contract.save();

    // Blockchain
    blockchain.totalTokens = blockchain.totalTokens.plus(BIG1);
    blockchain.save();
  }
  token.owner = to.id;
  token.burned = event.params.to.equals(Address.zero());
  token.totalTransactions = token.totalTransactions.plus(BIG1);
  token.updatedAt = event.block.timestamp;
  token.save();

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
  let doid = new DOID(event.params.id.toHexString());
  doid.owner = event.params.owner.toHexString();
  doid.address = event.params.owner.toHexString();
  doid.name = event.params.name.toString();
  doid.coinType = COINTYPE_ETH;
  doid.createdAt = event.block.timestamp;
  doid.blockNumber = event.block.number;
  doid.save();
}

export function handleAddressChanged(event: AddressChanged): void {
  let node = event.params.node;
  let doid = DOID.load(node.toHexString());
  if (doid == null) {
    return;
  }
  doid.address = event.params.newAddress.toHexString();
  doid.coinType = event.params.coinType;
  doid.save();
}
