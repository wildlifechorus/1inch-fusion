# 1inch Fusion Swap Project

This project provides an implementation of a token swap on Binance Smart Chain (BSC) using the 1inch Fusion SDK. The script demonstrates how to:

- Wrap BNB into WBNB.
- Unwrap WBNB into BNB.
- Approve ERC20 tokens for the Fusion contract.
- Get a quote for a token swap.
- Create and submit an order using the Fusion SDK.
- Fetch the status of an order.

## Prerequisites

To run this project, you will need the following:

- Node.js installed (v14 or higher recommended)
- An Ethereum-compatible wallet with private key
- Access to the BSC network (either a local node or a public RPC endpoint)
- A 1inch API key
- A `.env` file to store your private keys and RPC URLs securely

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-repo/1inch-fusion.git
   cd 1inch-fusion
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory and add the following variables:

   ```env
   PRIVATE_KEY=your_private_key
   RPC_URL=https://bsc-dataseed1.binance.org/
   ONE_INCH_API_KEY=your_1inch_api_key
   ```

## Usage

You can run the script using Node.js to perform a token swap on the Binance Smart Chain. The script handles wrapping and unwrapping of BNB, token approval, creating orders, and submitting them to the 1inch Fusion protocol.

### Example Command

```bash
node index.js
```

### Main Features

1. **Wrap BNB into WBNB**: The script wraps native BNB into WBNB when necessary to execute token swaps. This is needed because 1inch Fusion only supports ERC20 tokens, and native BNB is not an ERC20 token. To perform a swap with BNB, it must be wrapped into WBNB, which is an ERC20-compliant token.

2. **Unwrap WBNB into BNB**: If you are converting to BNB, the script can unwrap WBNB back into native BNB after the swap. This allows you to access the native BNB again once the swap is complete.

3. **Token Approval**: The script automatically checks and approves the required amount of tokens for the Fusion contract.

4. **Order Creation and Submission**: The script generates an order using the 1inch Fusion SDK and submits it to the network.

5. **Order Status Check**: After submitting an order, the script checks and prints the order status.

## Key Functions

### `wrapBNB(amountInWei)`

Wraps native BNB into WBNB to use in swaps.

### `unwrapWBNB(amountInWei)`

Unwraps WBNB back into native BNB after a swap.

### `approveToken(tokenAddress, amountInWei)`

Approves the specified token for the Fusion contract.

### `createAndSubmitOrder(quote, fromTokenAddress)`

Creates, signs, and submits an order for a token swap.

### `getOrderStatus(orderUid)`

Fetches and displays the status of the submitted order.

### Delay Function

The script introduces delays between API calls to comply with rate limits.

```javascript
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

## Example Swap

In this example, the script will swap `0.005` BNB into USDC:

```javascript
const amountToSwap = ethers.utils.parseUnits('0.005', 18); // 0.005 BNB
const USDC_ADDRESS = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'; // USDC token address
const BNB_ADDRESS = ethers.constants.AddressZero; // BNB uses address zero

main(BNB_ADDRESS, USDC_ADDRESS, amountToSwap);
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.
