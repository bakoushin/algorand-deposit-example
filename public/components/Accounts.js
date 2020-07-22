const Accounts = ({ accounts }) => {
  return accounts.map(({ address, balances }) => (
    <Account key={address} address={address} balances={balances} />
  ));
};
