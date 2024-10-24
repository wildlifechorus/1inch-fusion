require('dotenv').config();
const { FusionSDK, NetworkEnum } = require('@1inch/fusion-sdk');
const { ethers } = require('ethers');
const axios = require('axios'); // Import axios for API calls

// Initialize the environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL); // Your RPC URL
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Initialize the SDK
const sdk = new FusionSDK({
  url: 'https://api.1inch.dev/fusion',
  network: NetworkEnum.BINANCE,
  blockchainProvider: provider,
  authKey: process.env.ONE_INCH_API_KEY,
});

// wBNB contract Address
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
// Placeholder address for native BNB in the 1inch ecosystem
const BNB_PLACEHOLDER_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Function to manually sign the order
async function signTypedOrder(order, network) {
  const typedData = order.getTypedData(network); // Get EIP-712 typed data from order

  const domain = {
    name: typedData.domain.name,
    version: typedData.domain.version,
    chainId: typedData.domain.chainId,
    verifyingContract: typedData.domain.verifyingContract,
  };

  // Remove EIP712Domain from types
  const types = { ...typedData.types };
  delete types.EIP712Domain;

  const value = typedData.message; // Use the correct message structure

  // Manually sign the typed data using ethers.js
  const signature = await wallet._signTypedData(domain, types, value);

  return signature;
}

// Function to wrap BNB into WBNB
async function wrapBNB(amountInWei) {
  const WBNB_ABI = ['function deposit() payable'];
  const wbnbContract = new ethers.Contract(WBNB_ADDRESS, WBNB_ABI, wallet);

  // Estimate gas
  const gasEstimate = await wbnbContract.estimateGas.deposit({
    value: amountInWei,
  });
  console.log(`Estimated gas for wrapping: ${gasEstimate.toString()}`);

  const tx = await wbnbContract.deposit({
    value: amountInWei,
    gasLimit: gasEstimate,
  });
  await tx.wait();
  console.log(`Wrapped ${ethers.utils.formatEther(amountInWei)} BNB into WBNB`);
}

// Function to unwrap WBNB into BNB
async function unwrapWBNB() {
  const WBNB_ABI = [
    'function withdraw(uint256)',
    'function balanceOf(address) view returns (uint256)',
  ];
  const wbnbContract = new ethers.Contract(WBNB_ADDRESS, WBNB_ABI, wallet);

  // Get the WBNB balance
  const wbnbBalance = await wbnbContract.balanceOf(wallet.address);
  if (wbnbBalance.isZero()) {
    console.log('No WBNB balance to unwrap.');
    return;
  }

  // Estimate gas
  const gasEstimate = await wbnbContract.estimateGas.withdraw(wbnbBalance);
  console.log(`Estimated gas for unwrapping: ${gasEstimate.toString()}`);

  const tx = await wbnbContract.withdraw(wbnbBalance, {
    gasLimit: gasEstimate,
  });
  await tx.wait();
  console.log(
    `Unwrapped ${ethers.utils.formatEther(wbnbBalance)} WBNB into BNB`
  );
}

// Function to approve any ERC20 token for Fusion contract using 1inch API
async function approveToken(tokenAddress, amountInWei) {
  const chainId = 56; // BSC chain ID
  const apiBase = `https://api.1inch.dev/swap/v6.0/${chainId}`;
  const headers = {
    Authorization: `Bearer ${process.env.ONE_INCH_API_KEY}`,
  };

  // Check current allowance using 1inch API
  const allowanceUrl = `${apiBase}/approve/allowance`;
  const allowanceParams = {
    tokenAddress: tokenAddress,
    walletAddress: wallet.address,
  };

  try {
    const allowanceResponse = await axios.get(allowanceUrl, {
      params: allowanceParams,
      headers: headers,
    });
    const currentAllowance = ethers.BigNumber.from(
      allowanceResponse.data.allowance
    );

    if (currentAllowance.gte(amountInWei)) {
      console.log('Sufficient allowance already set for token:', tokenAddress);
      return;
    }
  } catch (error) {
    console.error(
      'Error fetching allowance:',
      error.response ? error.response.data : error.message
    );
    throw error;
  }

  // Get approval transaction data from 1inch API
  const approveTxUrl = `${apiBase}/approve/transaction`;
  const approveTxParams = {
    tokenAddress: tokenAddress,
    amount: amountInWei.toString(),
  };

  try {
    const approveTxResponse = await axios.get(approveTxUrl, {
      params: approveTxParams,
      headers: headers,
    });

    const txData = approveTxResponse.data;

    // Send the approval transaction
    const tx = await wallet.sendTransaction({
      to: txData.to,
      data: txData.data,
      value: txData.value
        ? ethers.BigNumber.from(txData.value)
        : ethers.constants.Zero,
    });

    await tx.wait();
    console.log(
      `Approved ${ethers.utils.formatEther(
        amountInWei
      )} tokens to Fusion contract for ${tokenAddress}`
    );
  } catch (error) {
    console.error(
      'Error approving token:',
      error.response ? error.response.data : error.message
    );
    throw error;
  }
}

// Function to create and submit the order using SDK
async function createAndSubmitOrder(quote, fromTokenAddress) {
  const orderParams = {
    fromTokenAddress: fromTokenAddress, // The token you are swapping from
    toTokenAddress: quote.params.toTokenAddress.val, // The token you are swapping to (from the quote)
    amount: quote.fromTokenAmount.toString(), // Convert BigInt to string
    walletAddress: wallet.address, // Your wallet address
    receiver: '0x0000000000000000000000000000000000000000', // Optional, defaults to wallet address
    preset: 'medium', // Use the recommended preset
    allowPartialFills: false, // Disallow partial fills for simplicity
    allowMultipleFills: false, // Disallow multiple fills for simplicity
  };

  // Generate the order using the SDK
  const { order, quoteId } = await sdk.createOrder(orderParams);

  // Manually sign the order
  const signature = await signTypedOrder(order, NetworkEnum.BINANCE);

  // Build the order struct and obtain the Order UID
  const orderStruct = order.build();
  const orderUid = order.getOrderHash(NetworkEnum.BINANCE); // This is the Order UID

  // Ensure the orderUid is a valid 66-character hex string
  if (!/^0x[0-9a-fA-F]{64}$/.test(orderUid)) {
    throw new Error('Invalid order hash generated');
  }

  console.log('Order UID:', orderUid);

  // Create the relayer request
  const relayerRequest = {
    order: orderStruct,
    signature,
    quoteId,
    extension: order.extension.encode(),
  };

  try {
    // Submit the order using the API directly
    await sdk.api.submitOrder(relayerRequest);
    console.log('Order submitted successfully');
  } catch (error) {
    console.error(
      'Error submitting order:',
      error.response ? error.response.data : error.message
    );
    throw error;
  }

  // Return the Order UID for further use
  return orderUid;
}

// Function to get order status using Order UID
async function getOrderStatus(orderUid) {
  try {
    // Use the Fusion SDK to get the order status
    const orderStatus = await sdk.getOrderStatus(orderUid);
    console.log('Order Status:', orderStatus.status);
    return orderStatus;
  } catch (error) {
    console.error(
      'Error fetching order status:',
      error.response ? error.response.data : error.message
    );
  }
}

// Simple delay function
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main function to get quote, wrap BNB, approve token, create order, and fetch order status
async function main(fromTokenAddress, toTokenAddress, amountInWei) {
  try {
    let needToWrapBNB = false;
    let needToUnwrapWBNB = false;

    // Check if we are swapping from BNB
    if (
      fromTokenAddress === ethers.constants.AddressZero ||
      fromTokenAddress.toLowerCase() === BNB_PLACEHOLDER_ADDRESS.toLowerCase()
    ) {
      console.log('Swapping from BNB');
      needToWrapBNB = true;
      // Use WBNB address when getting the quote
      fromTokenAddress = WBNB_ADDRESS;
    }

    // Check if we are swapping to BNB
    if (
      toTokenAddress === ethers.constants.AddressZero ||
      toTokenAddress.toLowerCase() === BNB_PLACEHOLDER_ADDRESS.toLowerCase()
    ) {
      console.log('Swapping to BNB');
      needToUnwrapWBNB = true;
      // Use WBNB address for swapping
      toTokenAddress = WBNB_ADDRESS;
    }

    // Get quote using the SDK with WBNB as the fromTokenAddress
    const quoteParams = {
      fromTokenAddress: fromTokenAddress, // WBNB address
      toTokenAddress: toTokenAddress, // Token to swap to
      amount: amountInWei.toString(), // Amount to swap in wei
      walletAddress: wallet.address, // Your wallet address
    };

    const quote = await sdk.getQuote(quoteParams);
    console.log('Quote response:', quote);

    // Wrap BNB if needed
    if (needToWrapBNB) {
      console.log('Wrapping BNB to WBNB...');
      await wrapBNB(amountInWei); // Wrap BNB into WBNB
    }

    // Approve the `fromTokenAddress` for Fusion contract
    await approveToken(fromTokenAddress, amountInWei);

    // Wait for 2 seconds to comply with rate limit
    await delay(2000);

    // Create, sign, and submit the order, and get the Order UID
    const orderUid = await createAndSubmitOrder(quote, fromTokenAddress);

    // Wait for the order to be filled
    console.log('Waiting for the order to be filled...');
    let orderStatus;
    while (true) {
      await delay(10000); // Wait for 10 seconds
      orderStatus = await getOrderStatus(orderUid);

      if (orderStatus.status === 'filled') {
        console.log('Order has been filled.');
        console.log(orderStatus);
        break;
      } else if (orderStatus.status === 'cancelled') {
        console.log('Order was cancelled.');
        return;
      } else {
        console.log('Order not yet filled. Waiting...');
      }
    }

    // Unwrap WBNB to BNB if swapping to BNB
    if (needToUnwrapWBNB) {
      console.log('Unwrapping WBNB to BNB...');
      await unwrapWBNB(); // Unwrap WBNB to BNB
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Execute the main function with dynamic tokens and amount
const amountToSwap = ethers.utils.parseUnits('0.005', 18); // Example amount: 0.005 BNB
const BNB_ADDRESS = ethers.constants.AddressZero; // BNB uses address zero
const USDC_ADDRESS = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'; // USDC token address on BSC

main(BNB_ADDRESS, USDC_ADDRESS, amountToSwap);
