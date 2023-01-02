import { Address, BigInt } from "@graphprotocol/graph-ts";
import { ERC721 } from "../../generated/Arts/ERC721";

export function fetchName(address: Address): string {
  const contract = ERC721.bind(address);

  const nameResult = contract.try_name();
  if (!nameResult.reverted) {
    return nameResult.value;
  }

  return "unknown";
}

export function fetchSymbol(address: Address): string {
  //const contract = NFT.bind(address);

  //const symbolResult = contract.try_symbol();
  //if (!symbolResult.reverted) {
  //  return symbolResult.value;
  //}

  return "";
}

export function fetchTokenURI(address: Address, tokenID: BigInt): string  {
  const contract = ERC721.bind(address);
  const uriResult = contract.try_tokenURI(tokenID);
  if (!uriResult.reverted) {
    return uriResult.value;
  }

  return "";
}