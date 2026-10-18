import { useCallback, useEffect, useState } from 'react';
import { Notice } from './components/Notice';
import { Table } from './components/Table';
import type { ClientConfig } from './config';
import { useConnectionState, useStore } from './connection/context';
import type { MockConnection } from './connection/mock';
import { DemoPanel } from './demo/DemoPanel';
import { DEMO_SERVER } from './demo/fixtures';
import { T } from './i18n/pt-BR';
import { Home } from './screens/Home';
import { WaitingRoom } from './screens/WaitingRoom';

const NAME_KEY = 'moises.nome';

function readSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Remembering the name is only a convenience.
  }
}

export interface AppProps {
  readonly config: ClientConfig;
  readonly mock: MockConnection | null;
}

export function App({ config, mock }: AppProps) {
  const store = useStore();
  const { status, room, view, turnDeadline, clockOffset, knownSettings, notice, lastSent } = useConnectionState();
  const [savedName] = useState(readSavedName);

  useEffect(() => {
    store.connection.connect();
  }, [store]);

  const dismiss = useCallback((id: number) => store.dismissNotice(id), [store]);
  const leave = useCallback(() => void store.connection.leaveRoom(), [store]);
  const backToRoom = useCallback(() => store.dismissGame(), [store]);

  const demo =
    config.demoTools && mock ? (placement: 'inline' | 'floating') => (
      <DemoPanel
        mock={mock}
        lastSent={lastSent}
        initialPlayers={config.demo?.players ?? DEMO_SERVER.players.min}
        placement={placement}
      />
    ) : null;

  return (
    <>
      {status !== 'connected' && status !== 'idle' && (
        <p className="connection" role="status">
          {T.status[status]}
        </p>
      )}
      {status === 'replaced' ? (
        <main className="lobby lobby--replaced">
          <h1 className="room__title">{T.replacedTitle}</h1>
          <p className="lobby__note">{T.replacedHint}</p>
          <button type="button" className="btn btn--primary btn--big" onClick={() => store.connection.connect()}>
            {T.replacedTakeBack}
          </button>
        </main>
      ) : view ? (
        <Table
          view={view}
          clockOffset={clockOffset}
          turnDeadline={turnDeadline}
          room={room}
          onSend={(action) => store.send(action)}
          onLeave={leave}
          {...(room ? { onBackToRoom: backToRoom } : {})}
          statusExtra={demo?.('inline')}
        />
      ) : room ? (
        <WaitingRoom connection={store.connection} room={room} />
      ) : (
        <Home
          connection={store.connection}
          initialName={savedName}
          onName={saveName}
          maxBots={knownSettings ? knownSettings.maxPlayers - 1 : null}
        />
      )}
      {!view && demo?.('floating')}
      <Notice notice={notice} onDismiss={dismiss} />
    </>
  );
}
