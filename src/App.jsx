import { useState } from 'react';
import useKongData from './hooks/useKongData.js';
import { cascadeDeleteService } from './lib/entities.js';
import ProjectLoader from './components/ProjectLoader.jsx';
import Dashboard from './components/Dashboard.jsx';
import ServiceDetail from './components/ServiceDetail.jsx';
import CreateFlow from './components/CreateFlow.jsx';
import YamlPreview from './components/YamlPreview.jsx';

// Three views: 'dashboard' (start), 'detail' (one service), 'create'.
// The YAML preview on the right is shared; each view feeds it via setPreviewLines.
export default function App() {
  const kong = useKongData();
  const [view, setView] = useState('dashboard');
  const [serviceIdx, setServiceIdx] = useState(null);
  const [previewLines, setPreviewLines] = useState([]);

  function goToDashboard() {
    setView('dashboard');
    setServiceIdx(null);
    setPreviewLines([]);
  }

  function openService(idx) {
    setServiceIdx(idx);
    setView('detail');
  }

  async function deleteServiceFromDashboard(idx) {
    const s = kong.dashData.services[idx];
    if (s) await cascadeDeleteService(kong.dashData, s, kong);
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-logo">
          <span className="vf-wordmark">vodafone</span>
          <div className="topbar-divider" />
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 20V10m-6 10V4M6 20v-6" />
          </svg>
          <span>Kong <em>Config</em> Generator</span>
        </div>
        <span className="topbar-badge">YAML 3.x · React</span>
        <div className="topbar-right">
          {view !== 'dashboard' && <button className="btn btn-ghost btn-sm" onClick={goToDashboard}>← Dashboard</button>}
        </div>
      </div>

      <div className="tabs-row">
        <button className={`tab ${view === 'dashboard' ? 'active' : ''}`} onClick={goToDashboard}>Dashboard</button>
        {view !== 'dashboard' && (
          <button className={`tab ${view === 'create' ? 'active' : ''}`} onClick={() => setView('create')}>
            {view === 'detail' ? kong.dashData.services[serviceIdx]?.name || 'Service' : 'Create New Service'}
          </button>
        )}
      </div>

      <div className="main">
        <div className="editor-pane">
          <ProjectLoader kong={kong} />
          {kong.error && (
            <div className="card" style={{ marginBottom: 12, borderColor: 'var(--danger)' }}>
              <div className="card-body"><span className="hint" style={{ color: 'var(--danger)' }}>{kong.error}</span></div>
            </div>
          )}
          {view === 'dashboard' && (
            <Dashboard
              dashData={kong.dashData}
              kong={kong}
              setPreviewLines={setPreviewLines}
              onOpenService={openService}
              onDeleteService={deleteServiceFromDashboard}
              onCreateNew={() => setView('create')}
            />
          )}
          {view === 'detail' && serviceIdx !== null && (
            <ServiceDetail
              dashData={kong.dashData}
              serviceIdx={serviceIdx}
              kong={kong}
              setPreviewLines={setPreviewLines}
              onBack={goToDashboard}
              onDeleted={goToDashboard}
            />
          )}
          {view === 'create' && (
            <CreateFlow dashData={kong.dashData} kong={kong} setPreviewLines={setPreviewLines} onDone={goToDashboard} />
          )}
        </div>
        <div className="preview-pane">
          <YamlPreview lines={previewLines} label={view === 'create' ? 'New Configuration' : 'Service Configuration'} />
        </div>
      </div>
    </div>
  );
}
