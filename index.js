require('dotenv').config();
const { FusionSDK, NetworkEnum } = require('@1inch/fusion-sdk');
const { ethers } = require('ethers');

// Initialize the environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Initialize the SDK
const sdk = new FusionSDK({
  url: 'https://api.1inch.dev/fusion',
  network: NetworkEnum.BINANCE,
  blockchainProvider: provider,
  authKey: process.env.ONE_INCH_API_KEY,
});

// Correct Fusion Settlement Contract Address
const FUSION_CONTRACT_ADDRESS = '0x111111125421cA6dc452d289314280a0f8842A65';

// wBNB contract Address
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
// Placeholder address for native BNB in the 1inch ecosystem
const BNB_PLACEHOLDER_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

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
  const tx = await wbnbContract.deposit({ value: amountInWei });
  await tx.wait();
  console.log(`Wrapped ${ethers.utils.formatEther(amountInWei)} BNB into WBNB`);
}

// Function to unwrap WBNB into BNB
async function unwrapWBNB(amountInWei) {
  const WBNB_ABI = ['function withdraw(uint256)'];
  const wbnbContract = new ethers.Contract(WBNB_ADDRESS, WBNB_ABI, wallet);
  const tx = await wbnbContract.withdraw(amountInWei);
  await tx.wait();
  console.log(
    `Unwrapped ${ethers.utils.formatEther(amountInWei)} WBNB into BNB`
  );
}

// Function to approve any ERC20 token for Fusion contract
async function approveToken(tokenAddress, amountInWei) {
  const ERC20_ABI = [
    'function approve(address spender, uint256 amount) public returns (bool)',
    'function allowance(address owner, address spender) public view returns (uint256)',
  ];
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

  // Check current allowance
  const currentAllowance = await tokenContract.allowance(
    wallet.address,
    FUSION_CONTRACT_ADDRESS
  );

  if (currentAllowance.gte(amountInWei)) {
    console.log('Sufficient allowance already set for token:', tokenAddress);
    return;
  }

  if (currentAllowance.gt(ethers.constants.Zero)) {
    console.log(
      'Existing allowance is less than required, resetting to zero...'
    );
    const txZero = await tokenContract.approve(FUSION_CONTRACT_ADDRESS, 0);
    await txZero.wait();
    console.log('Allowance reset to zero for token:', tokenAddress);
  }

  // Approve the Fusion contract with the required amount
  const tx = await tokenContract.approve(FUSION_CONTRACT_ADDRESS, amountInWei);
  await tx.wait();
  console.log(
    `Approved ${ethers.utils.formatEther(
      amountInWei
    )} tokens to Fusion contract for ${tokenAddress}`
  );
}

// Function to create and submit the order using SDK
async function createAndSubmitOrder(quote, fromTokenAddress) {
  const orderParams = {
    fromTokenAddress: fromTokenAddress, // The token you are swapping from
    toTokenAddress: quote.params.toTokenAddress.val, // The token you are swapping to (from the quote)
    amount: quote.fromTokenAmount.toString(), // Convert BigInt to string
    walletAddress: wallet.address, // Your wallet address
    receiver: '0x0000000000000000000000000000000000000000', // Optional, defaults to wallet address
    preset: 'fast', // Use the recommended preset
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
    console.log('Order Status:', orderStatus);
  } catch (error) {
    console.error(
      'Error fetching order status:',
      error.response ? error.response.data : error.message
    );
  }
}

// Main function to wrap/unwrap BNB, approve token, get quote, submit order, and fetch order status
async function main(fromTokenAddress, toTokenAddress, amountInWei) {
  try {
    // Check if we are swapping from or to BNB and use the correct address
    if (fromTokenAddress === ethers.constants.AddressZero) {
      console.log('Wrapping BNB to WBNB...');
      await wrapBNB(amountInWei); // Wrap BNB into WBNB if BNB is the source
      fromTokenAddress = WBNB_ADDRESS; // Swap using WBNB instead of BNB
    } else if (fromTokenAddress === BNB_PLACEHOLDER_ADDRESS) {
      fromTokenAddress = WBNB_ADDRESS; // Swap using WBNB instead of BNB
    }

    if (toTokenAddress === ethers.constants.AddressZero) {
      toTokenAddress = BNB_PLACEHOLDER_ADDRESS; // Use the 1inch placeholder address for BNB
    }

    // Approve the `fromTokenAddress` for Fusion contract
    await approveToken(fromTokenAddress, amountInWei);

    // Get quote using the SDK with dynamic token pair
    const quoteParams = {
      fromTokenAddress: fromTokenAddress, // Token to swap from (WBNB if wrapped)
      toTokenAddress: toTokenAddress, // Token to swap to
      amount: amountInWei.toString(), // Amount to swap in wei
      walletAddress: wallet.address, // Your wallet address
    };

    const quote = await sdk.getQuote(quoteParams);
    console.log('Quote response:', quote);

    // Wait for 2 seconds to comply with rate limit
    await delay(2000);

    // Create, sign, and submit the order, and get the Order UID
    const orderUid = await createAndSubmitOrder(quote, fromTokenAddress);

    // Wait for 2 seconds to comply with rate limit
    await delay(2000);

    // Fetch and display order status using the Order UID
    await getOrderStatus(orderUid);

    // Unwrap WBNB to BNB if swapping to BNB
    if (toTokenAddress === BNB_PLACEHOLDER_ADDRESS) {
      console.log('Unwrapping WBNB to BNB...');
      await unwrapWBNB(amountInWei); // Unwrap WBNB to BNB
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Simple delay function
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Execute the main function with dynamic tokens and amount
const amountToSwap = ethers.utils.parseUnits('0.005', 18); // Example amount: 0.005 BNB
const USDC_ADDRESS = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'; // USDC token address
const BNB_ADDRESS = ethers.constants.AddressZero; // BNB uses address zero

main(BNB_ADDRESS, USDC_ADDRESS, amountToSwap);
