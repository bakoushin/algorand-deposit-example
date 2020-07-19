const algosdk = require('algosdk');

// Algorand minimal balance
const ALGORAND_MINIMAL_BALANCE = 100000;

/**
 * Get asset id by unit name.
 *
 * @param {Algodv2} algodClient Instance of the Algodv2 client
 * @param {Kmd} kmdClient Instance of the Kmd client
 * @param {Indexer} indexerClient Instance of the Indexer client
 * @param {String} name Unit name of the asset
 * @return {Number} Asset id
 */
async function getAssetId(algodClient, kmdClient, indexerClient, name) {
  const { assets } = await indexerClient.searchForAssets().unit(name).do();

  if (assets.length) {
    return assets[0].index;
  }

  // If asset doesn't exist, create one
  const assetId = await createAsset(algodClient, kmdClient, name);

  return assetId;
}

/**
 * Ensure that second account in the Sandbox default wallet has
 * enough asset balance to make transactions.
 *
 * If the account is not opted-in for the asset, an opt-in transaction is created.
 * If the balance is not sufficient, it is topped up.
 *
 * @param {Algodv2} algodClient Instance of the Algodv2 client
 * @param {Kmd} kmdClient Instance of the Kmd client
 * @param {Number} assetId Asset id
 */
async function ensureSecondDefaultAccountHasAssetBalance(
  algodClient,
  kmdClient,
  assetId
) {
  const MIN_ASSET_BALANCE = 10000;

  const { wallets } = await kmdClient.listWallets();
  const hotWallet = wallets.find(
    ({ name }) => name === process.env.HOT_WALLET_NAME
  );
  const { wallet_handle_token: hotWalletHandle } =
    await kmdClient.initWalletHandle(
      hotWallet.id,
      process.env.HOT_WALLET_PASSWORD
    );
  const {
    addresses: [firstAccount, secondAccount]
  } = await kmdClient.listKeys(hotWalletHandle);

  const { assets } = await algodClient.accountInformation(secondAccount).do();
  const asset = assets.find((asset) => asset['asset-id'] === assetId);

  let assetBalance = 0;

  if (asset) {
    assetBalance = asset.amount;
  } else {
    await makeOptInTransaction(
      algodClient,
      kmdClient,
      hotWalletHandle,
      process.env.HOT_WALLET_PASSWORD,
      secondAccount,
      assetId
    );
  }

  if (assetBalance < MIN_ASSET_BALANCE) {
    const amount = MIN_ASSET_BALANCE - assetBalance;

    const params = await algodClient.getTransactionParams().do();
    const closeRemainderTo = undefined;
    const revocationTarget = undefined;
    const note = undefined;

    const txo = algosdk.makeAssetTransferTxnWithSuggestedParams(
      firstAccount,
      secondAccount,
      closeRemainderTo,
      revocationTarget,
      amount,
      note,
      assetId,
      params
    );

    const blob = await kmdClient.signTransaction(
      hotWalletHandle,
      process.env.HOT_WALLET_PASSWORD,
      txo
    );

    const { txId } = await algodClient.sendRawTransaction(blob).do();
    await waitForConfirmation(algodClient, txId);
  }

  await kmdClient.releaseWalletHandle(hotWalletHandle);
}

/**
 * Create a new Algorand Standard Asset (ASA).
 *
 * @param {Algodv2} algodClient Instance of the Algodv2 client
 * @param {Kmd} kmdClient Instance of the Kmd client
 * @param {String} name Asset name
 * @param {Number} [totalSupply=100000] Total supply of the created asset
 * @param {Number} [decimals=0] Number of decimals of created asset
 * @return {Number} Created asset id
 */
async function createAsset(
  algodClient,
  kmdClient,
  name,
  totalSupply = 100000,
  decimals = 0
) {
  const { wallets } = await kmdClient.listWallets();
  const hotWallet = wallets.find(
    ({ name }) => name === process.env.HOT_WALLET_NAME
  );
  const { wallet_handle_token: hotWalletHandle } =
    await kmdClient.initWalletHandle(
      hotWallet.id,
      process.env.HOT_WALLET_PASSWORD
    );
  const {
    addresses: [creatorAddress]
  } = await kmdClient.listKeys(hotWalletHandle);

  const note = undefined;
  const defaultFrozen = false;
  const manager = creatorAddress;
  const reserve = creatorAddress;
  const freeze = creatorAddress;
  const clawback = creatorAddress;
  const unitName = name;
  const assetName = name;
  const assetURL = '';
  const assetMetadataHash = undefined;
  const params = await algodClient.getTransactionParams().do();

  const txo = algosdk.makeAssetCreateTxnWithSuggestedParams(
    creatorAddress,
    note,
    totalSupply,
    decimals,
    defaultFrozen,
    manager,
    reserve,
    freeze,
    clawback,
    unitName,
    assetName,
    assetURL,
    assetMetadataHash,
    params
  );

  const blob = await kmdClient.signTransaction(
    hotWalletHandle,
    process.env.HOT_WALLET_PASSWORD,
    txo
  );

  await kmdClient.releaseWalletHandle(hotWalletHandle);

  const { txId } = await algodClient.sendRawTransaction(blob).do();
  const txInfo = await waitForConfirmation(algodClient, txId);

  const assetId = txInfo['asset-index'];

  return assetId;
}

/**
 * Get deposit wallet object. If deposit wallet does not exist, it is created.
 *
 * @param {Kmd} kmdClient Instance of the Kmd client
 * @return {Object} Wallet object
 */
async function getDepositWallet(kmdClient) {
  const { wallets } = await kmdClient.listWallets();
  let wallet = wallets.find(
    ({ name }) => name === process.env.DEPOSIT_WALLET_NAME
  );

  // If deposit_wallet does not exists, initialize one
  if (!wallet) {
    const masterDerivationKey = await algosdk.mnemonicToMasterDerivationKey(
      process.env.DEPOSIT_WALLET_MNEMONIC
    );

    const result = await kmdClient.createWallet(
      process.env.DEPOSIT_WALLET_NAME,
      process.env.DEPOSIT_WALLET_PASSWORD,
      masterDerivationKey
    );
    wallet = result.wallet;
  }

  return wallet;
}

/**
 * Get first address in the Sanbox default wallet.
 * It is considered as a hot wallet for demonstration purposes.
 *
 * @param {Kmd} kmdClient Instance of the Kmd client
 * @return {String} First address in the Sanbox default wallet
 */
async function getDefaultHotWalletAddress(kmdClient) {
  const { wallets } = await kmdClient.listWallets();
  const hotWallet = wallets.find(
    ({ name }) => name === process.env.HOT_WALLET_NAME
  );
  const { wallet_handle_token: hotWalletHandle } =
    await kmdClient.initWalletHandle(
      hotWallet.id,
      process.env.HOT_WALLET_PASSWORD
    );
  const {
    addresses: [defaultAddress]
  } = await kmdClient.listKeys(hotWalletHandle);
  await kmdClient.releaseWalletHandle(hotWalletHandle);

  return defaultAddress;
}

/**
 * Execute and opt-in transaction
 *
 * @param {Algodv2} algodClient Instance of the Algodv2 client
 * @param {Kmd} kmdClient Instance of the Kmd client
 * @param {String} address Adress to opt-in
 * @param {Number} assetId Asset to opt-in for
 * @return {Object} Transaction information
 */
async function makeOptInTransaction(
  algodClient,
  kmdClient,
  walletHandle,
  walletPassword,
  address,
  assetId
) {
  // Get hot wallet handle and default address
  const { wallets } = await kmdClient.listWallets();
  const hotWallet = wallets.find(
    ({ name }) => name === process.env.HOT_WALLET_NAME
  );
  const { wallet_handle_token: hotWalletHandle } =
    await kmdClient.initWalletHandle(
      hotWallet.id,
      process.env.HOT_WALLET_PASSWORD
    );
  const {
    addresses: [defaultAddress]
  } = await kmdClient.listKeys(hotWalletHandle);

  // Create a transaction sending necessary amount to the account we want to opt-in (the top up transaction)
  const txo1 = await (async () => {
    const amount = ALGORAND_MINIMAL_BALANCE * 2 + algosdk.ALGORAND_MIN_TX_FEE; // Minimal balance + transaction fee (in Algos)
    const sender = defaultAddress;
    const receiver = address;
    const params = await algodClient.getTransactionParams().do();
    const closeRemainderTo = undefined; // not used since we don't want to close the account
    const note = undefined; // no additional notes

    const txo = algosdk.makePaymentTxnWithSuggestedParams(
      sender,
      receiver,
      amount,
      closeRemainderTo,
      note,
      params
    );

    return txo;
  })();

  // Create an opt-in transaction
  const txo2 = await (async () => {
    const amount = 0;

    const params = await algodClient.getTransactionParams().do();
    const closeRemainderTo = undefined;
    const revocationTarget = undefined;
    const note = undefined;

    // Create opt-in transaction (note that sender and receiver addresses are the same)
    const txo = algosdk.makeAssetTransferTxnWithSuggestedParams(
      address,
      address,
      closeRemainderTo,
      revocationTarget,
      amount,
      note,
      assetId,
      params
    );

    return txo;
  })();

  algosdk.assignGroupID([txo1, txo2]);

  // Sign the top up transaction
  const blob1 = await kmdClient.signTransaction(
    hotWalletHandle,
    process.env.HOT_WALLET_PASSWORD,
    txo1
  );

  // Sign the opt-in transaction
  const blob2 = await kmdClient.signTransaction(
    walletHandle,
    walletPassword,
    txo2
  );

  // Send both transactions as an atomic group
  const { txId } = await algodClient.sendRawTransaction([blob1, blob2]).do();
  const [txInfo] = await Promise.all([
    waitForConfirmation(algodClient, txId),
    kmdClient.releaseWalletHandle(hotWalletHandle)
  ]);

  return txInfo;
}

/**
 * Resolves with transaction information when transaction is confirmed.
 *
 * @param {Algodv2} algodClient Instance of the Algodv2 client
 * @param {String} txId Transaction Id to watch on
 * @param {Number} [timeout=60000] Waiting timeout (default: 1 minute)
 * @return {Object} Transaction information
 */
async function waitForConfirmation(algodClient, txId, timeout = 60000) {
  let { 'last-round': lastRound } = await algodClient.status().do();
  while (timeout > 0) {
    const startTime = Date.now();
    // Get transaction details
    const txInfo = await algodClient.pendingTransactionInformation(txId).do();
    if (txInfo) {
      if (txInfo['confirmed-round']) {
        return txInfo;
      } else if (txInfo['pool-error'] && txInfo['pool-error'].length > 0) {
        throw new Error(txInfo['pool-error']);
      }
    }
    // Wait for the next round
    await algodClient.statusAfterBlock(++lastRound).do();
    timeout -= Date.now() - startTime;
  }
  throw new Error('Timeout exceeded');
}

module.exports = {
  ALGORAND_MINIMAL_BALANCE,
  getAssetId,
  ensureSecondDefaultAccountHasAssetBalance,
  createAsset,
  getDepositWallet,
  getDefaultHotWalletAddress,
  waitForConfirmation,
  makeOptInTransaction
};
