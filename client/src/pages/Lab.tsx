import { useState } from 'react';
import clsx from 'clsx';
import { PageHeader } from '../components/ui';
import { useRefs } from './lab/shared';
import RefsTab from './lab/RefsTab';
import FingerprintTab from './lab/FingerprintTab';
import JudgeTab from './lab/JudgeTab';
import KeySearchTab from './lab/KeySearchTab';
import AlgorithmsTab from './lab/AlgorithmsTab';
import CribsTab from './lab/CribsTab';
import ExperimentsTab from './lab/ExperimentsTab';
import VizTab from './lab/VizTab';

const TABS = ['Corpus de référence', 'Empreintes', 'Juge', 'Recherche de clé', 'Algorithmes & calcul', 'Indices', 'Visualisations', 'Journal'] as const;
type Tab = (typeof TABS)[number];

export default function Lab() {
  const [tab, setTab] = useState<Tab>('Corpus de référence');
  const [prefill, setPrefill] = useState<string | null>(null);
  const refs = useRefs();
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      <PageHeader
        title="Laboratoire"
        subtitle="Le moteur scientifique : comparer, tester, réfuter. Vous et les agents utilisez les mêmes outils, et chaque résultat est consigné dans le journal."
      />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-surface-700">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition', tab === t ? 'border-primary-500 text-primary-400' : 'border-transparent text-fg-300 hover:text-fg-50')}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Corpus de référence' && <RefsTab refs={refs} />}
      {tab === 'Empreintes' && <FingerprintTab refs={refs} />}
      {tab === 'Juge' && <JudgeTab refs={refs} prefill={prefill} />}
      {tab === 'Recherche de clé' && <KeySearchTab refs={refs} onJudge={(m) => { setPrefill(m); setTab('Juge'); }} />}
      {tab === 'Algorithmes & calcul' && <AlgorithmsTab refs={refs} />}
      {tab === 'Indices' && <CribsTab />}
      {tab === 'Visualisations' && <VizTab />}
      {tab === 'Journal' && <ExperimentsTab />}
    </div>
  );
}
