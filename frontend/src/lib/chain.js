import { ethers } from "ethers";
import info from "../contract.json";

export const CONTRACT = info;
export const STATUS = ["none", "pending", "approved", "suspended"];
export const CHAIN_ID = import.meta.env.VITE_CHAIN_ID || "0xaa36a7";
export const RPC = import.meta.env.VITE_SEPOLIA_RPC || (CHAIN_ID === "0x7a69" ? "http://127.0.0.1:8545" : "https://ethereum-sepolia-rpc.publicnode.com");

export const SEPOLIA_CHAIN_ID_DECIMAL = 11155111n;
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

export const TARGET_CHAIN_HEX = (CHAIN_ID || "0xaa36a7").toLowerCase();
export const TARGET_CHAIN_DECIMAL = BigInt(TARGET_CHAIN_HEX === "0x7a69" || TARGET_CHAIN_HEX === "31337" ? 31337 : 11155111);

export const readProvider = new ethers.JsonRpcProvider(RPC);
export const readContract = new ethers.Contract(info.address, info.abi, readProvider);

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/**
 * Strictly verifies the connected wallet network matches Sepolia (or configured target).
 * If on the wrong network (e.g. Ethereum Mainnet), requests an immediate switch via MetaMask.
 * If rejected, aborts immediately to ensure no funds or transactions are ever sent on Mainnet.
 */
export async function ensureNetwork(signerOrProvider) {
  if (!window.ethereum) throw new Error("MetaMask is not installed. Please install it from metamask.io.");

  let provider;
  if (signerOrProvider?.provider instanceof ethers.BrowserProvider) {
    provider = signerOrProvider.provider;
  } else {
    provider = new ethers.BrowserProvider(window.ethereum);
  }

  const network = await provider.getNetwork();
  if (network.chainId !== TARGET_CHAIN_DECIMAL) {
    const isLocal = TARGET_CHAIN_HEX === "0x7a69" || TARGET_CHAIN_HEX === "31337";
    const chainConfig = isLocal
      ? {
          chainId: "0x7a69",
          chainName: "Hardhat Localhost",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [RPC],
        }
      : {
          chainId: "0xaa36a7",
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [RPC],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        };

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainConfig.chainId }],
      });
    } catch (e) {
      if (e.code === 4902 || e?.error?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [chainConfig],
        });
      } else if (e.code === 4001 || e?.error?.code === 4001) {
        throw new Error("Network switch to Sepolia testnet was rejected. VITalLedger will NOT submit transactions on Ethereum Mainnet to protect your funds.");
      } else {
        throw new Error(`Please switch MetaMask to Sepolia testnet (Chain ID 11155111). Error: ${e.message || e}`);
      }
    }

    // Verify after switch
    const verifyProvider = new ethers.BrowserProvider(window.ethereum);
    const verifyNet = await verifyProvider.getNetwork();
    if (verifyNet.chainId !== TARGET_CHAIN_DECIMAL) {
      throw new Error(`Wallet is connected to chain ID ${verifyNet.chainId}, but VITalLedger requires Sepolia (11155111). Transaction cancelled.`);
    }
  }
  return true;
}

/**
 * Creates a contract instance attached to the signer, wrapped with strict network verification.
 * Any mutating method call will verify Sepolia network before MetaMask displays a transaction prompt.
 */
export function writeContract(signer) {
  const contract = new ethers.Contract(info.address, info.abi, signer);
  return new Proxy(contract, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig === "function" && typeof prop === "string" && !["getAddress", "interface", "runner", "connect"].includes(prop)) {
        return async (...args) => {
          await ensureNetwork(signer);
          try {
            return await orig.apply(target, args);
          } catch (err) {
            // If the transaction failed (e.g. during gas estimation with coalesce error or revert),
            // try simulating with staticCall to retrieve the exact EVM revert return data.
            if (typeof target[prop]?.staticCall === "function" && (err?.shortMessage?.includes("coalesce") || err?.code === "UNKNOWN_ERROR" || !err?.reason)) {
              try {
                await target[prop].staticCall(...args);
              } catch (staticErr) {
                if (staticErr?.data || staticErr?.reason) {
                  err.data = staticErr.data || err.data;
                  err.reason = staticErr.reason || err.reason;
                }
              }
            }
            throw err;
          }
        };
      }
      return orig;
    },
  });
}

export async function connectWallet({ promptSelect = false } = {}) {
  if (!window.ethereum) throw new Error("MetaMask not found. Install it from metamask.io and refresh.");
  
  if (promptSelect) {
    try {
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch (e) {
      if (e.code === 4001) throw new Error("Account selection cancelled.");
    }
  } else {
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
  }

  // Strictly enforce and switch to target network (Sepolia)
  await ensureNetwork();

  const signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
  return { signer, address: await signer.getAddress() };
}

/** Must stay identical to the backend's rxContent(). */
export const rxContent = (o) => JSON.stringify({
  patient: o.patient.toLowerCase(), doctor: o.doctor.toLowerCase(),
  medicine: o.medicine, dosage: o.dosage, nonce: o.nonce,
});
