const Account = ({ address, balances }) => {
  const isASA = balances.length > 1;

  const topUpAmount = isASA
    ? Math.floor(Math.random() * 100)
    : 100000 + Math.floor(Math.random() * 100000);

  const commandExample = isASA
    ? `./sandbox goal asset send \\\n  --from $(./sandbox goal account list | awk 'NR==2 {print $2}') \\\n  --to ${address} \\\n  --assetid ${balances[1].assetId} \\\n  --amount ${topUpAmount}`
    : `./sandbox goal clerk send \\\n  --from $(./sandbox goal account list | awk 'NR==2 {print $2}') \\\n  --to ${address} \\\n  --amount ${topUpAmount}`;

  const handleCopy = () => copyToClipboard(commandExample);

  return (
    <div className="account">
      <div className="header">
        {address} <Balances balances={balances} />
      </div>
      <div>
        <br />
        Top up command:
      </div>
      <div className="command">
        <code>
          <pre className="command-code">{commandExample}</pre>
        </code>
        <button onClick={handleCopy}>Copy</button>
      </div>
    </div>
  );
};
