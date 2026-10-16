/**
 * AccoladesModal - Toggle accolades that provide permanent stat bonuses.
 *
 * The toggles are derived from the exported Accolades powerset (see @/data/accolades);
 * each stands alone (on/off), with a hero/villain/any faction label. There is no mutual
 * exclusion — the real activateRequires gates don't 1:1-pair (DATA-GAP data-gaps-44).
 */

import { useBuildStore } from '@/stores';
import { getAccolades, accoladeId, accoladeFaction, accoladeRequiredModes } from '@/data';
import type { AccoladePower } from '@/data';
import { Modal, ModalBody, ModalFooter } from './Modal';
import { Button } from '@/components/ui';

interface AccoladesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FACTION_LABEL: Record<string, string> = {
  hero: 'Hero',
  villain: 'Villain',
  any: 'Any',
};

export function AccoladesModal({ isOpen, onClose }: AccoladesModalProps) {
  const accolades = getAccolades();
  const buildAccolades = useBuildStore((s) => s.build.accolades);
  const addAccolade = useBuildStore((s) => s.addAccolade);
  const removeAccolade = useBuildStore((s) => s.removeAccolade);

  const isAccoladeEnabled = (id: string) => buildAccolades.includes(id);

  const toggleAccolade = (power: AccoladePower) => {
    const id = accoladeId(power);
    if (isAccoladeEnabled(id)) {
      removeAccolade(id);
    } else {
      addAccolade(id);
    }
  };

  const clearAll = () => {
    for (const id of [...buildAccolades]) {
      removeAccolade(id);
    }
  };

  const enabledCount = buildAccolades.length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Accolades" size="sm">
      <ModalBody className="p-0">
        {/* Info banner */}
        <div className="px-4 py-2 bg-amber-900/30 border-b border-gray-700">
          <p className="text-sm text-amber-300">
            Accolades are permanent passive powers that provide stat bonuses.
            <span className="text-gray-400 ml-1">({enabledCount} enabled)</span>
          </p>
        </div>

        {/* Accolades list */}
        <div className="p-4 space-y-2">
          {accolades.map((accolade) => {
            const id = accoladeId(accolade);
            const enabled = isAccoladeEnabled(id);
            const faction = accoladeFaction(accolade);
            // A mode requirement means the buff is real but conditional: the totals fold it in
            // either way, so the row says what the number can't. Read off the def, so no
            // accolade is named here.
            const requires = accoladeRequiredModes(accolade).join(', ');
            return (
              <button
                key={id}
                onClick={() => toggleAccolade(accolade)}
                className={`
                  w-full flex items-center gap-3 p-3 rounded-lg border transition-all
                  ${
                    enabled
                      ? 'bg-amber-900/40 border-amber-500 text-amber-100'
                      : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-600 hover:bg-gray-800'
                  }
                `}
              >
                {/* Checkbox indicator */}
                <div
                  className={`
                    w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors
                    ${enabled ? 'bg-amber-500 border-amber-500' : 'border-gray-500'}
                  `}
                >
                  {enabled && (
                    <svg
                      className="w-3 h-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>

                {/* Accolade info */}
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{accolade.name}</span>
                    {faction !== 'any' && (
                      <span className="text-[10px] uppercase tracking-wide text-gray-500 border border-gray-600 rounded px-1">
                        {FACTION_LABEL[faction]}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {accolade.shortHelp || accolade.description}
                  </div>
                  {requires && (
                    <div className="text-xs text-amber-400/90 mt-0.5">
                      Requires {requires}. Counted in totals regardless.
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={clearAll} disabled={enabledCount === 0}>
          Clear All
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}
