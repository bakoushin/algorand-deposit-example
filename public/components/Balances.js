const Balances = ({ balances }) => {
  const item = balances[1] || balances[0];

  const amount =
    balances.length === 1
      ? algosdk.microalgosToAlgos(item.amount)
      : item.amount;

  return (
    <span key={item.asset}>
      <span className="accent">{amount}</span> <span>{item.asset}</span>
    </span>
  );
};
