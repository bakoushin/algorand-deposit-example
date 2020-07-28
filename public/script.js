const App = () => {
  const [accounts, setAccounts] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [testAssetId, setTestAssetId] = React.useState(null);

  const fetchAccounts = () =>
    fetch('/accounts')
      .then((res) => res.json())
      .then((data) => data);

  React.useEffect(() => {
    fetchAccounts()
      .then((data) => {
        setAccounts(data);
        setLoading(false);
      })
      .catch(console.error);

    fetch('/test-asset-id')
      .then((res) => res.json())
      .then(({ id }) => setTestAssetId(id))
      .catch(console.error);
  }, []);

  React.useEffect(() => {
    const handleMessage = ({ data }) => {
      const event = JSON.parse(data);
      setEvents((prevEvents) => [event, ...prevEvents]);
      fetchAccounts()
        .then((data) => setAccounts(data))
        .catch(console.error);
    };

    const eventSource = new EventSource('updates');
    eventSource.addEventListener('message', handleMessage);

    return () => {
      eventSource.removeEventListener('message', handleMessage);
      eventSource.close();
    };
  }, []);

  const [isCreatingAlgoAccount, setIsCreatingAlgoAccount] =
    React.useState(false);

  const handleAddAlgoAccount = async () => {
    setIsCreatingAlgoAccount(true);
    try {
      await fetch('/accounts', { method: 'POST' });
      const data = await fetchAccounts();
      setAccounts(data);
    } catch (error) {
      console.error(error);
    }
    setIsCreatingAlgoAccount(false);
  };

  const [isCreatingTestAccount, setIsCreatingTestAccount] =
    React.useState(false);

  const handleAddTestAccount = async () => {
    setIsCreatingTestAccount(true);
    try {
      await fetch('/accounts', {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ assetId: testAssetId })
      });
      const res = await fetch('/accounts');
      const data = await res.json();
      setAccounts(data);
    } catch (error) {
      console.error(error);
    }
    setIsCreatingTestAccount(false);
  };

  return (
    <div>
      <pre>
        <code>
          <h2>Accounts</h2>
          {loading ? (
            <Spinner />
          ) : (
            <div>
              <Accounts accounts={accounts} />
              <br />
              <div className="buttons">
                <span className="button">
                  {isCreatingAlgoAccount ? (
                    <Spinner />
                  ) : (
                    <button onClick={handleAddAlgoAccount}>
                      Add ALGO account
                    </button>
                  )}
                </span>
                <span className="button">
                  {isCreatingTestAccount || !testAssetId ? (
                    <Spinner />
                  ) : (
                    <button onClick={handleAddTestAccount}>
                      Add TEST account
                    </button>
                  )}
                </span>
              </div>
            </div>
          )}
          <hr />
          <h2>Events</h2>
          <Events events={events} />
        </code>
      </pre>
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById('root'));
