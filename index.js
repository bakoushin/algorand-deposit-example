require('dotenv').config();
const path = require('path');
const fastify = require('fastify')();
const algosdk = require('algosdk');
const DepositWatcher = require('./DepositWatcher');
const {
  ALGORAND_MINIMAL_BALANCE,
  getAssetId,
  ensureSecondDefaultAccountHasAssetBalance,
  getDepositWallet,
  getDefaultHotWalletAddress,
  makeOptInTransaction
} = require('./utils');

// Init Algorand endpoints
const algodClient = new algosdk.Algodv2(
  process.env.ALGOD_TOKEN,
  process.env.ALGOD_SERVER,
  process.env.ALGOD_PORT
);
const kmdClient = new algosdk.Kmd(
  process.env.KMD_TOKEN,
  process.env.KMD_SERVER,
  process.env.KMD_PORT
);
const indexerClient = new algosdk.Indexer(
  process.env.INDEXER_TOKEN,
  process.env.INDEXER_SERVER,
  process.env.INDEXER_PORT
);

fastify.register(require('fastify-static'), {
  root: path.join(__dirname, 'public')
});

(async () => {
  // Initialize the Sanbox environment for the demo
  console.log('Initializing...');

  // Find the deposit_wallet or create it if not exists
  const wallet = await getDepositWallet(kmdClient);

  // Get deposit wallet addresses
  const { wallet_handle_token: walletHandle } =
    await kmdClient.initWalletHandle(
      wallet.id,
      process.env.DEPOSIT_WALLET_PASSWORD
    );
  const { addresses } = await kmdClient.listKeys(walletHandle);
  await kmdClient.releaseWalletHandle(walletHandle);

  // Init DepositWatcher
  const defaultHotWalletAddress = await getDefaultHotWalletAddress(kmdClient);
  const ignoreSenders = [defaultHotWalletAddress];
  const depositWatcher = new DepositWatcher(
    indexerClient,
    addresses,
    ignoreSenders
  );

  // Get TEST asset id or create it if not exists
  const testAssetName = 'TEST';
  const testAssedId = await getAssetId(
    algodClient,
    kmdClient,
    indexerClient,
    testAssetName
  );

  // Ensure that second account in the Sanbox default wallet has enough TEST balance.
  // It will be used to send TEST to deposit wallet.
  await ensureSecondDefaultAccountHasAssetBalance(
    algodClient,
    kmdClient,
    testAssedId
  );

  console.log('Ready');

  // Exposed APIs:
  // * GET /acconts – get all deposit accounts
  // * POST /accounts – create new deposit account (send { assetId: <Number> } in body to create account for an ASA)
  // * GET /updates – subscribe to server-sent events for deposit notifications
  // * GET /test-asset-id – get TEST asset id

  // Get all accounts
  fastify.get('/accounts', async (request, reply) => {
    // Connect with wallet
    const { wallet_handle_token: walletHandle } =
      await kmdClient.initWalletHandle(
        wallet.id,
        process.env.DEPOSIT_WALLET_PASSWORD
      );
    // Get accounts list
    const { addresses } = await kmdClient.listKeys(walletHandle);

    // Get account balances
    const result = [];
    if (addresses) {
      for (const address of addresses) {
        const { amount, assets } = await algodClient
          .accountInformation(address)
          .do();

        let algoBalance = amount;

        // Having at least one ASA requires keeping minimal balance
        if (assets.length) algoBalance -= ALGORAND_MINIMAL_BALANCE;

        const assetBalances = [];
        for (const { 'asset-id': assetId, amount } of assets) {
          const {
            params: { 'unit-name': asset }
          } = await algodClient.getAssetByID(assetId).do();
          assetBalances.push({ asset, assetId, amount });

          // Each ASA requires keeping minimal balance
          algoBalance -= ALGORAND_MINIMAL_BALANCE;
        }

        result.push({
          address,
          balances: [{ asset: 'ALGO', amount: algoBalance }, ...assetBalances]
        });
      }
    }
    // Send accounts list along with the balances
    reply.send(result);
    // Close wallet connection
    await kmdClient.releaseWalletHandle(walletHandle);
  });

  // Generate new account
  fastify.post('/accounts', async (request, reply) => {
    const { wallet_handle_token: walletHandle } =
      await kmdClient.initWalletHandle(
        wallet.id,
        process.env.DEPOSIT_WALLET_PASSWORD
      );

    const { address } = await kmdClient.generateKey(walletHandle);

    // Opt-in transaction for ASA
    if (request.body && request.body.assetId) {
      await makeOptInTransaction(
        algodClient,
        kmdClient,
        walletHandle,
        process.env.DEPOSIT_WALLET_PASSWORD,
        address,
        request.body.assetId
      );
    }

    depositWatcher.addresses.add(address);

    reply.send({ address });

    await kmdClient.releaseWalletHandle(walletHandle);
  });

  // Server-sent events for account balance updates
  fastify.get('/updates', (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache'
    });

    const handleDepositAlgo = (txInfo) => {
      const type = 'deposit_algo';
      const data = { type, txInfo };
      reply.raw.write(`data: ${JSON.stringify(data)} \n\n`);
    };

    const handleDepositASA = (txInfo) => {
      const type = 'deposit_asa';
      const data = { type, txInfo };
      reply.raw.write(`data: ${JSON.stringify(data)} \n\n`);
    };

    depositWatcher.on('deposit_algo', handleDepositAlgo);
    depositWatcher.on('deposit_asa', handleDepositASA);

    const unsubscribe = () => {
      depositWatcher.off('deposit_algo', handleDepositAlgo);
      depositWatcher.off('deposit_asa', handleDepositASA);
    };

    reply.then(unsubscribe, unsubscribe);
  });

  // Get TEST asset id
  fastify.get('/test-asset-id', (request, reply) => {
    reply.send({ id: testAssedId });
  });

  // Start server
  fastify.listen(process.env.PORT, (error, address) => {
    if (error) {
      fastify.log.error(err);
      process.exit(1);
    }
    fastify.log.info(`Server is listening on ${address}`);
    console.log(`Server is listening on ${address}`);
  });
})().catch((error) => {
  console.error(error);
});
