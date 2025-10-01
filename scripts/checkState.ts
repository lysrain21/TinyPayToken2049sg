import { network } from "hardhat";

const CONTRACT_ADDRESS = "0xfEAE0653D8FfA8fbCd23A3410F10CEdeFD56db0a";

async function main() {
  const { viem } = await network.connect();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TinyPay", CONTRACT_ADDRESS);

  const balance = await contract.read.getBalance([deployer.account.address]);
  console.log("User contract balance:", balance.toString());
  const tail = await contract.read.getUserTail([deployer.account.address]);
  console.log("User tail:", tail);
  const stats = await contract.read.getSystemStats();
  console.log("System stats:", stats);
  const walletBalance = await publicClient.getBalance({ address: deployer.account.address });
  console.log("Wallet ETH balance:", walletBalance.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
