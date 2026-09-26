import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, Bot, CheckCircle2, ClipboardCheck, Gauge, HardHat,
  Leaf, Lightbulb, PackageSearch, Plus, ShieldCheck, Sparkles, Target,
  Timer, TriangleAlert, Zap
} from 'lucide-react';
import { Project, Screen, User } from '../../types';
import apiClient from '../../lib/api/client';

interface ConstructionInnovationHubProps {
  currentUser: User;
  project?: Project;
  navigateTo: (screen: Screen, params?: any) => void;
}

type IdeaStatus = 'idea' | 'pilot' | 'proven';

interface InnovationIdea {
  id: string;
  title: string;
  area: string;
  impact: number;
  effort: number;
  status: IdeaStatus;
  createdAt: string;
}

interface Constraint {
  id: string;
  title: string;
  owner: string;
  severity: 'high' | 'medium' | 'low';
  resolved: boolean;
}

const seedIdeas: InnovationIdea[] = [
  { id: 'seed-1', title: 'QR handover packs for installed façade zones', area: 'Quality', impact: 5, effort: 2, status: 'pilot', createdAt: '2026-09-26' },
  { id: 'seed-2', title: 'Pre-sort fixing kits by elevation and workface', area: 'Productivity', impact: 4, effort: 2, status: 'idea', createdAt: '2026-09-26' },
  { id: 'seed-3', title: 'Photo-based delivery damage capture at gate', area: 'Logistics', impact: 4, effort: 1, status: 'proven', createdAt: '2026-09-26' }
];

const seedConstraints: Constraint[] = [
  { id: 'c-1', title: 'Drawing revision not confirmed for north elevation', owner: 'Design', severity: 'high', resolved: false },
  { id: 'c-2', title: 'Insulation delivery split across two drops', owner: 'Procurement', severity: 'medium', resolved: false },
  { id: 'c-3', title: 'MEWP charging location agreed', owner: 'Site', severity: 'low', resolved: true }
];

const scoreIdea = (idea: InnovationIdea) => (idea.impact * 2) + (6 - idea.effort);

const normalizeIdea = (row: any): InnovationIdea => ({
  id: String(row.id),
  title: String(row.title || ''),
  area: String(row.area || 'Productivity'),
  impact: Number(row.impact || 3),
  effort: Number(row.effort || 3),
  status: (row.status || 'idea') as IdeaStatus,
  createdAt: String(row.created_at || row.createdAt || new Date().toISOString())
});

const normalizeConstraint = (row: any): Constraint => ({
  id: String(row.id),
  title: String(row.title || ''),
  owner: String(row.owner || 'Site'),
  severity: (row.severity || 'medium') as Constraint['severity'],
  resolved: Boolean(row.resolved)
});

const ConstructionInnovationHub: React.FC<ConstructionInnovationHubProps> = ({
  currentUser,
  project,
  navigateTo
}) => {
  const storageKey = useMemo(
    () => 'cortexbuild:innovation:' + currentUser.companyId + ':' + (project?.id || 'portfolio'),
    [currentUser.companyId, project?.id]
  );

  const [ideas, setIdeas] = useState<InnovationIdea[]>(() => {
    if (typeof window === 'undefined') return seedIdeas;
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : seedIdeas;
    } catch {
      return seedIdeas;
    }
  });
  const [constraints, setConstraints] = useState<Constraint[]>(() => {
    if (typeof window === 'undefined') return seedConstraints;
    try {
      const stored = window.localStorage.getItem(storageKey + ':constraints');
      return stored ? JSON.parse(stored) : seedConstraints;
    } catch {
      return seedConstraints;
    }
  });
  const [syncState, setSyncState] = useState<'syncing' | 'synced' | 'offline'>('syncing');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftArea, setDraftArea] = useState('Productivity');
  const [draftImpact, setDraftImpact] = useState(4);
  const [draftEffort, setDraftEffort] = useState(2);
  const [draftConstraint, setDraftConstraint] = useState('');
  const [draftConstraintOwner, setDraftConstraintOwner] = useState('Site');
  const [draftConstraintSeverity, setDraftConstraintSeverity] = useState<Constraint['severity']>('medium');
  const [plannedUnits, setPlannedUnits] = useState(120);
  const [installedUnits, setInstalledUnits] = useState(94);
  const [crewSize, setCrewSize] = useState(6);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(ideas));
    window.localStorage.setItem(storageKey + ':constraints', JSON.stringify(constraints));
    window.localStorage.setItem(storageKey + ':productivity', JSON.stringify({
      plannedUnits,
      installedUnits,
      crewSize
    }));
  }, [ideas, constraints, plannedUnits, installedUnits, crewSize, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(storageKey + ':productivity');
      if (!stored) return;
      const snapshot = JSON.parse(stored);
      if (Number.isFinite(Number(snapshot.plannedUnits))) setPlannedUnits(Number(snapshot.plannedUnits));
      if (Number.isFinite(Number(snapshot.installedUnits))) setInstalledUnits(Number(snapshot.installedUnits));
      if (Number.isFinite(Number(snapshot.crewSize))) setCrewSize(Number(snapshot.crewSize));
    } catch {
      // Keep safe defaults when offline cache is malformed.
    }
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    setSyncState('syncing');

    apiClient.fetchInnovationOverview(project?.id)
      .then((data) => {
        if (!active) return;
        setIdeas(Array.isArray(data?.ideas) ? data.ideas.map(normalizeIdea) : []);
        setConstraints(Array.isArray(data?.constraints) ? data.constraints.map(normalizeConstraint) : []);

        const latest = Array.isArray(data?.productivity) ? data.productivity[0] : null;
        if (latest) {
          setPlannedUnits(Number(latest.planned_units || 0));
          setInstalledUnits(Number(latest.installed_units || 0));
          setCrewSize(Number(latest.crew_size || 0));
          setLastSavedAt(String(latest.created_at || latest.work_date || ''));
        }
        setSyncState('synced');
      })
      .catch(() => {
        if (active) setSyncState('offline');
      });

    return () => {
      active = false;
    };
  }, [project?.id]);

  const productivity = plannedUnits > 0 ? Math.round((installedUnits / plannedUnits) * 100) : 0;
  const unitsPerPerson = crewSize > 0 ? (installedUnits / crewSize).toFixed(1) : '0.0';
  const openConstraints = constraints.filter(item => !item.resolved).length;
  const provenCount = ideas.filter(item => item.status === 'proven').length;
  const bestIdea = [...ideas].sort((a, b) => scoreIdea(b) - scoreIdea(a))[0];

  const addIdea = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title) return;

    const optimistic: InnovationIdea = {
      id: 'local-' + Date.now(),
      title,
      area: draftArea,
      impact: draftImpact,
      effort: draftEffort,
      status: 'idea',
      createdAt: new Date().toISOString()
    };

    setIdeas(current => [optimistic, ...current]);
    setDraftTitle('');

    try {
      const saved = await apiClient.createInnovationIdea({
        project_id: project?.id || null,
        title,
        area: draftArea,
        impact: draftImpact,
        effort: draftEffort
      });
      setIdeas(current => current.map(item => item.id === optimistic.id ? normalizeIdea(saved) : item));
      setSyncState('synced');
    } catch {
      setSyncState('offline');
    }
  };

  const moveIdea = async (id: string) => {
    const idea = ideas.find(item => item.id === id);
    if (!idea) return;
    const next: IdeaStatus = idea.status === 'idea' ? 'pilot' : idea.status === 'pilot' ? 'proven' : 'proven';
    setIdeas(current => current.map(item => item.id === id ? { ...item, status: next } : item));

    if (id.startsWith('local-') || id.startsWith('seed-')) {
      setSyncState('offline');
      return;
    }

    try {
      const saved = await apiClient.updateInnovationIdea(id, { status: next });
      setIdeas(current => current.map(item => item.id === id ? normalizeIdea(saved) : item));
      setSyncState('synced');
    } catch {
      setSyncState('offline');
    }
  };

  const addConstraint = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = draftConstraint.trim();
    if (!title) return;

    const optimistic: Constraint = {
      id: 'local-constraint-' + Date.now(),
      title,
      owner: draftConstraintOwner.trim() || 'Site',
      severity: draftConstraintSeverity,
      resolved: false
    };

    setConstraints(current => [optimistic, ...current]);
    setDraftConstraint('');

    try {
      const saved = await apiClient.createInnovationConstraint({
        project_id: project?.id || null,
        title,
        owner: optimistic.owner,
        severity: optimistic.severity
      });
      setConstraints(current => current.map(item => item.id === optimistic.id ? normalizeConstraint(saved) : item));
      setSyncState('synced');
    } catch {
      setSyncState('offline');
    }
  };

  const toggleConstraint = async (item: Constraint) => {
    const resolved = !item.resolved;
    setConstraints(current => current.map(c => c.id === item.id ? { ...c, resolved } : c));

    if (item.id.startsWith('local-') || item.id.startsWith('c-')) {
      setSyncState('offline');
      return;
    }

    try {
      const saved = await apiClient.updateInnovationConstraint(item.id, { resolved });
      setConstraints(current => current.map(c => c.id === item.id ? normalizeConstraint(saved) : c));
      setSyncState('synced');
    } catch {
      setSyncState('offline');
    }
  };

  const saveProductivitySnapshot = async () => {
    try {
      const saved = await apiClient.saveInnovationProductivity({
        project_id: project?.id || null,
        work_date: new Date().toISOString().slice(0, 10),
        planned_units: plannedUnits,
        installed_units: installedUnits,
        crew_size: crewSize,
        unit_label: 'units'
      });
      setLastSavedAt(String(saved?.created_at || new Date().toISOString()));
      setSyncState('synced');
    } catch {
      setSyncState('offline');
    }
  };

  const quickLaunches: Array<{ label: string; description: string; screen: Screen; icon: React.ComponentType<any> }> = [
    { label: 'Daily field log', description: 'Capture labour, plant, materials and site notes.', screen: 'daily-log', icon: ClipboardCheck },
    { label: 'Task control', description: 'Turn blockers and improvements into accountable work.', screen: 'tasks', icon: Target },
    { label: 'Documents', description: 'Open drawings, evidence and project records.', screen: 'documents', icon: PackageSearch },
    { label: 'AI tools', description: 'Use the existing assistants for analysis and drafting.', screen: 'ai-tools', icon: Bot },
    { label: 'Automation studio', description: 'Convert repeat site routines into workflows.', screen: 'automation-studio', icon: Zap },
    { label: 'Business development', description: 'Connect improvements to bids, tenders and growth.', screen: 'business-development', icon: Sparkles }
  ];

  const statusClasses: Record<IdeaStatus, string> = {
    idea: 'bg-slate-100 text-slate-700',
    pilot: 'bg-amber-100 text-amber-800',
    proven: 'bg-emerald-100 text-emerald-800'
  };

  const severityClasses: Record<Constraint['severity'], string> = {
    high: 'bg-rose-100 text-rose-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-sky-100 text-sky-700'
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-2xl sm:p-8">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_0.6fr] lg:items-end">
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                <HardHat className="h-4 w-4" />
                Construction Innovation OS
              </div>
              <div className={'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ' + (
                syncState === 'synced'
                  ? 'bg-emerald-400/15 text-emerald-200'
                  : syncState === 'syncing'
                    ? 'bg-amber-400/15 text-amber-200'
                    : 'bg-slate-400/15 text-slate-300'
              )}>
                <span className={'h-2 w-2 rounded-full ' + (
                  syncState === 'synced' ? 'bg-emerald-300' : syncState === 'syncing' ? 'bg-amber-300' : 'bg-slate-400'
                )} />
                {syncState === 'synced' ? 'Shared live' : syncState === 'syncing' ? 'Syncing' : 'Offline cache'}
              </div>
            </div>
            <h1 className="max-w-4xl text-3xl font-black tracking-tight sm:text-5xl">
              Turn field friction into measurable improvement.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              One operational cockpit for productivity, constraints, site ideas, safety, procurement and automation.
              Every improvement stays scoped to {project?.name || 'your company portfolio'}.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <p className="text-xs uppercase tracking-wider text-slate-400">Next best action</p>
            <p className="mt-2 text-lg font-bold">{bestIdea?.title || 'Capture the first improvement idea'}</p>
            <p className="mt-2 text-sm text-slate-300">
              {bestIdea ? 'Highest impact-to-effort score: ' + scoreIdea(bestIdea) + '/15.' : 'Add a field improvement below.'}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Plan achieved', value: productivity + '%', note: installedUnits + ' / ' + plannedUnits + ' units', icon: Gauge },
          { label: 'Units / person', value: unitsPerPerson, note: crewSize + ' people today', icon: Activity },
          { label: 'Open constraints', value: String(openConstraints), note: 'Resolve before they hit programme', icon: TriangleAlert },
          { label: 'Proven improvements', value: String(provenCount), note: ideas.length + ' ideas in the pipeline', icon: Lightbulb }
        ].map(metric => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                <Icon className="h-5 w-5 text-slate-400" />
              </div>
              <p className="mt-3 text-3xl font-black text-slate-950">{metric.value}</p>
              <p className="mt-1 text-xs text-slate-500">{metric.note}</p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Timer className="h-6 w-6 text-cyan-600" />
            <div>
              <h2 className="text-xl font-bold text-slate-950">Today&apos;s productivity pulse</h2>
              <p className="text-sm text-slate-500">Simple field measurement without waiting for a report.</p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              ['Planned units', plannedUnits, setPlannedUnits],
              ['Installed units', installedUnits, setInstalledUnits],
              ['Crew size', crewSize, setCrewSize]
            ].map(([label, value, setter]) => (
              <label key={String(label)} className="text-sm font-medium text-slate-600">
                {String(label)}
                <input
                  type="number"
                  min="0"
                  value={Number(value)}
                  onChange={event => (setter as React.Dispatch<React.SetStateAction<number>>)(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-lg font-bold text-slate-950 outline-none ring-cyan-500 transition focus:ring-2"
                />
              </label>
            ))}
          </div>
          <div className="mt-5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-3 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all" style={{ width: Math.min(productivity, 100) + '%' }} />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">Daily plan progress</span>
            <span className="font-bold text-slate-950">{productivity}%</span>
          </div>
          <button
            type="button"
            onClick={saveProductivitySnapshot}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-700"
          >
            <CheckCircle2 className="h-4 w-4" />
            Save today&apos;s snapshot
          </button>
          {lastSavedAt && <p className="mt-2 text-center text-xs text-slate-400">Last shared snapshot: {new Date(lastSavedAt).toLocaleString()}</p>}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <h2 className="text-xl font-bold text-slate-950">Constraint radar</h2>
              <p className="text-sm text-slate-500">Make blockers visible before they become delay.</p>
            </div>
          </div>
          <form onSubmit={addConstraint} className="mt-5 grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[1fr_120px_110px_auto]">
            <input
              value={draftConstraint}
              onChange={event => setDraftConstraint(event.target.value)}
              placeholder="Add a site blocker..."
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-emerald-500 focus:ring-2"
            />
            <input
              value={draftConstraintOwner}
              onChange={event => setDraftConstraintOwner(event.target.value)}
              placeholder="Owner"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-emerald-500 focus:ring-2"
            />
            <select
              value={draftConstraintSeverity}
              onChange={event => setDraftConstraintSeverity(event.target.value as Constraint['severity'])}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button type="submit" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
              Add blocker
            </button>
          </form>
          <div className="mt-4 space-y-3">
            {constraints.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleConstraint(item)}
                className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 p-4 text-left transition hover:border-slate-300"
              >
                {item.resolved ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <TriangleAlert className="h-5 w-5 shrink-0 text-amber-500" />}
                <div className="min-w-0 flex-1">
                  <p className={'font-semibold ' + (item.resolved ? 'text-slate-400 line-through' : 'text-slate-900')}>{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500">Owner: {item.owner}</p>
                </div>
                <span className={'rounded-full px-2.5 py-1 text-xs font-bold ' + severityClasses[item.severity]}>{item.severity}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-violet-700">
              <Lightbulb className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Continuous improvement</span>
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Innovation backlog</h2>
            <p className="mt-1 text-sm text-slate-500">Score ideas by impact and effort, pilot the best ones, then standardise what works.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
            <Leaf className="h-4 w-4 text-emerald-300" />
            Less waste. Safer work. Faster handover.
          </div>
        </div>

        <form onSubmit={addIdea} className="mt-6 grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-[1fr_160px_110px_110px_auto]">
          <input
            value={draftTitle}
            onChange={event => setDraftTitle(event.target.value)}
            placeholder="Capture an improvement from the field..."
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-violet-500 transition focus:ring-2"
          />
          <select value={draftArea} onChange={event => setDraftArea(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
            <option>Productivity</option>
            <option>Safety</option>
            <option>Quality</option>
            <option>Logistics</option>
            <option>Procurement</option>
            <option>Carbon</option>
          </select>
          <select value={draftImpact} onChange={event => setDraftImpact(Number(event.target.value))} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
            {[5,4,3,2,1].map(value => <option key={value} value={value}>Impact {value}</option>)}
          </select>
          <select value={draftEffort} onChange={event => setDraftEffort(Number(event.target.value))} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
            {[1,2,3,4,5].map(value => <option key={value} value={value}>Effort {value}</option>)}
          </select>
          <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-700">
            <Plus className="h-4 w-4" />
            Add
          </button>
        </form>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {ideas.map(idea => (
            <article key={idea.id} className="rounded-2xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-3">
                <span className={'rounded-full px-2.5 py-1 text-xs font-bold capitalize ' + statusClasses[idea.status]}>{idea.status}</span>
                <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-black text-white">Score {scoreIdea(idea)}/15</span>
              </div>
              <h3 className="mt-4 min-h-12 text-base font-bold leading-6 text-slate-950">{idea.title}</h3>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-slate-50 p-2"><span className="block text-slate-400">Area</span><b>{idea.area}</b></div>
                <div className="rounded-xl bg-slate-50 p-2"><span className="block text-slate-400">Impact</span><b>{idea.impact}/5</b></div>
                <div className="rounded-xl bg-slate-50 p-2"><span className="block text-slate-400">Effort</span><b>{idea.effort}/5</b></div>
              </div>
              {idea.status !== 'proven' && (
                <button type="button" onClick={() => moveIdea(idea.id)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-800 transition hover:bg-slate-50">
                  {idea.status === 'idea' ? 'Start pilot' : 'Mark proven'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-black text-slate-950">Launch the work</h2>
          <p className="text-sm text-slate-500">Innovation should flow into the tools your site team already uses.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {quickLaunches.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => navigateTo(item.screen)}
                className="group flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md"
              >
                <div className="rounded-xl bg-slate-950 p-3 text-white"><Icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-slate-950">{item.label}</h3>
                  <p className="mt-1 text-sm leading-5 text-slate-500">{item.description}</p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-cyan-600" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default ConstructionInnovationHub;
