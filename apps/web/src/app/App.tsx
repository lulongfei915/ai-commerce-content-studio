import { SessionGate } from '../features/auth/SessionGate';
import studioMark from '../features/tasks/studio-mark.svg';
import '../styles/global.css';
import '../styles/select.css';

export function App() {
  return (
    <div className="studio-shell">
      <header className="studio-header">
        <img src={studioMark} alt="" width={32} height={32} />
        <strong>造物 Studio</strong>
      </header>
      <main className="studio-content"><SessionGate /></main>
    </div>
  );
}
