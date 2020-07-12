const EventEmitter = require('events');

class DepositWatcher extends EventEmitter {
  /**
   * @param {Indexer} indexer Instance of the Indexer client
   * @param {Array<string>} addresses Addresses to watch
   * @param {Array<string>} ingoreSenders Sender addresses to ignore
   * @param {Number} [interval=1000] Query interval (default: 1 second)
   */
  constructor(indexer, addresses, ignoreSenders = [], interval = 1000) {
    super();

    this.indexer = indexer;
    this.addresses = new Set(addresses);
    this.ignoreSenders = new Set(ignoreSenders);
    this.interval = interval;

    this.seenRounds = new Map();
    this.lastRound = null;
    this.startTime = Date.now();

    this.processTransactions();
  }

  async processTransactions() {
    try {
      // We want to get all transactions since last round we've seen
      // or since current time if we don't know current round number yet.
      let query = this.indexer.searchForTransactions();
      if (this.lastRound) {
        query = query.minRound(this.lastRound);
      } else {
        query = query.afterTime(new Date().toISOString());
      }
      const queryResult = await query.do();

      // Types of transactions we want to process:
      // `pay` – Algo transfer
      // `axfer` – ASA transfer
      const txTypes = new Set(['pay', 'axfer']);

      for (const tx of queryResult.transactions) {
        const {
          id,
          sender,
          'tx-type': txType,
          'confirmed-round': confirmedRound,
          'round-time': roundTime
        } = tx;

        // Skip transactions happened before start of the watcher
        if (roundTime * 1000 < this.startTime) continue;

        // Skip transactions types we are not interested in
        if (!txTypes.has(txType)) continue;

        const { amount, receiver } =
          tx['payment-transaction'] || tx['asset-transfer-transaction'];

        // Process only deposits to our addresses
        if (!this.addresses.has(receiver)) continue;

        // Skip transactions from addresses we ignore, e.g. our own
        if (this.ignoreSenders.has(sender)) continue;

        // Skip ASA opt-in transactions
        if (txType === 'axfer' && sender === receiver && amount === 0) continue;

        // Ensure skipping already processed transactions
        const hasBeenSeen =
          this.seenRounds.has(confirmedRound) &&
          this.seenRounds.get(confirmedRound).has(id);
        if (hasBeenSeen) continue;

        // Remember transaction round and id
        if (!this.seenRounds.has(confirmedRound)) {
          this.seenRounds.set(confirmedRound, new Set());
        }
        this.seenRounds.get(confirmedRound).add(id);

        // Finally, emit deposit event
        if (txType === 'axfer') {
          // ASA transfer
          const assetID = tx['asset-transfer-transaction']['asset-id'];
          this.emit('deposit_asa', { id, receiver, sender, assetID, amount });
        } else {
          // Algo transfer
          this.emit('deposit_algo', { id, receiver, sender, amount });
        }
      }

      // Clear seen transactions from previous rounds
      const currentRound = queryResult['current-round'];
      if (currentRound !== this.lastRound) {
        for (const key of this.seenRounds.keys()) {
          if (key < currentRound) this.seenRounds.delete(key);
        }
      }

      // Save round number to limit further queries
      this.lastRound = currentRound;
    } catch (error) {
      console.error(error);
    }

    // Repeat on given interval
    setTimeout(() => this.processTransactions(), this.interval);
  }
}

module.exports = DepositWatcher;
