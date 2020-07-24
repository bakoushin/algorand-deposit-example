const Events = ({ events }) => {
  return events.map(({ type, txInfo }) => (
    <div key={JSON.stringify(txInfo)} className="event">
      <h4>{type}</h4>
      <div>{JSON.stringify(txInfo, null, 2)}</div>
    </div>
  ));
};
