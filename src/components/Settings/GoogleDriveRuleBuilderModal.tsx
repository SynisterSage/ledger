import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';

export type GoogleDriveRuleSource = {
  id: string;
  name: string;
  relationship?: { project?: { id: string; name: string } | null } | null;
};

export type GoogleDriveRule = {
  id: string;
  name: string;
  connected_source_id?: string | null;
  project_id?: string | null;
  trigger_type?: string;
  conditions?: Array<{ field?: string; operator?: string; value?: unknown }>;
  actions?: Array<{ type?: string }>;
  enabled?: boolean;
};

const triggers = [
  ['file_added', 'A file is added'],
  ['file_updated', 'A file is updated'],
  ['file_moved_in', 'A file is moved into the folder'],
  ['file_moved_out', 'A file is moved out of the folder'],
  ['file_trashed', 'A file is deleted or trashed'],
  ['file_access_lost', 'Access to a file is lost'],
  ['file_restored', 'A file is restored'],
] as const;

const conditionFields = [
  ['file_type', 'File type', 'equals'],
  ['extension', 'File extension', 'equals'],
  ['name', 'File name contains', 'contains'],
  ['parent_folder', 'Parent folder', 'equals'],
  ['already_intake', 'Already in Intake', 'equals'],
  ['already_resource', 'Already linked to project', 'equals'],
] as const;

const actions = [
  ['send_to_intake', 'Send to Intake'],
  ['add_to_project_resources', 'Link to project resources'],
  ['add_project_activity', 'Add project activity'],
] as const;

const labelFor = (values: readonly (readonly string[])[], value?: string) => values.find(([key]) => key === value)?.[1] || value || '—';
type RuleCondition = { field: string; operator: string; value: string };

export function GoogleDriveRuleBuilderModal({ sources, initialRule, onClose, onSave, busy }: { sources: GoogleDriveRuleSource[]; initialRule?: GoogleDriveRule | null; onClose: () => void; onSave: (sourceId: string, payload: Record<string, unknown>, ruleId?: string) => Promise<void>; busy: boolean }) {
  const [sourceId, setSourceId] = useState(initialRule?.connected_source_id || sources[0]?.id || '');
  const [name, setName] = useState(initialRule?.name || '');
  const [trigger, setTrigger] = useState(initialRule?.trigger_type || 'file_added');
  const [conditions, setConditions] = useState<RuleCondition[]>(() => (initialRule?.conditions || []).map((condition) => ({ field: condition.field || 'file_type', operator: condition.operator || 'equals', value: String(condition.value ?? '') })));
  const [selectedActions, setSelectedActions] = useState<string[]>(initialRule?.actions?.map((action) => String(action.type || '')).filter(Boolean) || ['send_to_intake']);
  const [nameTouched, setNameTouched] = useState(false);
  const source = sources.find((item) => item.id === sourceId);

  useEffect(() => {
    if (!sourceId && sources[0]) setSourceId(sources[0].id);
  }, [sourceId, sources]);

  const addCondition = () => setConditions((current) => [...current, { field: 'file_type', operator: 'equals', value: '' }]);
  const updateCondition = (index: number, changes: Partial<RuleCondition>) => setConditions((current) => current.map((condition, conditionIndex) => conditionIndex === index ? { ...condition, ...changes } : condition));
  const removeCondition = (index: number) => setConditions((current) => current.filter((_, conditionIndex) => conditionIndex !== index));
  const toggleAction = (value: string) => setSelectedActions((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const save = async () => {
    setNameTouched(true);
    if (!sourceId || !name.trim() || !selectedActions.length || conditions.some((condition) => !condition.value.trim())) return;
    await onSave(sourceId, {
      name: name.trim(),
      trigger_type: trigger,
      project_id: source?.relationship?.project?.id || null,
      conditions,
      actions: selectedActions.map((type) => ({ type })),
    }, initialRule?.id);
  };

  return <ModalOverlay isOpen onClose={onClose} backdropBorderRadius="inherit" disablePortal manageWindowChrome={false} classNameContent="overflow-hidden" classNameContainer="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]">
    <div className="flex max-h-[min(680px,calc(100vh-48px))] flex-col">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ledger-border-subtle)] px-5 py-4"><div><p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">Google Drive</p><h2 className="mt-1 text-lg font-semibold">{initialRule ? 'Edit rule' : 'Create rule'}</h2><p className="mt-1 text-sm text-[var(--ledger-text-muted)]">Automate changes in a connected Drive folder.</p></div><ModalCloseButton onClick={onClose} ariaLabel="Close rule builder" /></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <label className="block text-xs font-medium">Rule name<input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => setNameTouched(true)} placeholder="Final PDF handoff" aria-invalid={nameTouched && !name.trim()} className="mt-1 h-9 w-full rounded-lg border border-[var(--ledger-border-subtle)] bg-transparent px-3 text-sm outline-none focus:border-[var(--ledger-accent)] aria-[invalid=true]:border-[var(--ledger-danger)]" />{nameTouched && !name.trim() && <span className="mt-1 block text-[11px] text-[var(--ledger-danger)]">Enter a rule name.</span>}</label>
        <label className="mt-4 block text-xs font-medium">When<select value={trigger} onChange={(event) => setTrigger(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--ledger-border-subtle)] bg-transparent px-3 text-sm outline-none">{triggers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="mt-4 block text-xs font-medium">Folder<select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--ledger-border-subtle)] bg-transparent px-3 text-sm outline-none">{sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{source?.relationship?.project?.name && <span className="mt-1 block text-[11px] font-normal text-[var(--ledger-text-muted)]">{source.relationship.project.name} · Connected Drive folder</span>}</label>
        <div className="mt-5"><div className="flex items-center justify-between"><p className="text-xs font-medium">Conditions</p><button type="button" onClick={addCondition} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ledger-accent)] hover:text-[var(--ledger-accent-hover)]"><Plus size={13} />Add condition</button></div>{conditions.length ? <div className="mt-2 space-y-2">{conditions.map((condition, index) => { const field = conditionFields.find(([value]) => value === condition.field) || conditionFields[0]; return <div key={`${condition.field}-${index}`} className="flex items-center gap-2"><select aria-label={`Condition ${index + 1} field`} value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value, operator: conditionFields.find(([value]) => value === event.target.value)?.[2] || 'equals' })} className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--ledger-border-subtle)] bg-transparent px-2 text-sm outline-none">{conditionFields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="text-xs text-[var(--ledger-text-muted)]">is</span><input aria-label={`Condition ${index + 1} value`} value={condition.value} onChange={(event) => updateCondition(index, { value: event.target.value })} placeholder={field[0] === 'file_type' ? 'application/pdf' : 'PDF'} className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--ledger-border-subtle)] bg-transparent px-3 text-sm outline-none focus:border-[var(--ledger-accent)]" /><button type="button" onClick={() => removeCondition(index)} aria-label={`Remove condition ${index + 1}`} className="rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"><X size={15} /></button></div>; })}</div> : <p className="mt-2 text-xs text-[var(--ledger-text-muted)]">No conditions — this rule applies to every matching file.</p>}</div>
        <div className="mt-5"><p className="text-xs font-medium">Actions</p><div className="mt-2 space-y-1.5">{actions.map(([value, label]) => <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--ledger-border-subtle)] px-3 py-2.5 transition hover:bg-[var(--ledger-surface-hover)]"><input type="checkbox" checked={selectedActions.includes(value)} onChange={() => toggleAction(value)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ledger-accent)]" /><span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-[11px] leading-4 text-[var(--ledger-text-muted)]">{value === 'send_to_intake' ? 'Create an Intake item for the file.' : value === 'add_to_project_resources' ? 'Add the file to the connected project.' : 'Record the change in project activity.'}</span></span></label>)}</div></div>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--ledger-border-subtle)] px-5 py-3"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" disabled={busy || !sourceId || !name.trim() || !selectedActions.length || conditions.some((condition) => !condition.value.trim())} onClick={() => void save()} className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : initialRule ? 'Save changes' : 'Create rule'}</button></footer>
    </div>
  </ModalOverlay>;
}

export function GoogleDriveRuleTestModal({ rule, source, onClose }: { rule: GoogleDriveRule; source?: GoogleDriveRuleSource; onClose: () => void }) {
  return <ModalOverlay isOpen onClose={onClose} classNameContainer="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"><div className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] text-[var(--ledger-text-muted)]">Google Drive rule</p><h2 className="mt-1 text-base font-semibold">Test rule</h2></div><button type="button" onClick={onClose} className="rounded-md p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"><X size={16} /></button></div><div className="mt-5 space-y-3 text-sm"><div><p className="text-[11px] text-[var(--ledger-text-muted)]">Trigger</p><p className="mt-1">{labelFor(triggers, rule.trigger_type)}</p></div><div><p className="text-[11px] text-[var(--ledger-text-muted)]">Source</p><p className="mt-1">{source?.name || 'Connected Drive folder'}</p></div><div><p className="text-[11px] text-[var(--ledger-text-muted)]">Conditions</p><p className="mt-1 text-[var(--ledger-text-secondary)]">{rule.conditions?.length ? rule.conditions.map((condition) => `${labelFor(conditionFields, condition.field)} ${condition.operator || 'is'} ${String(condition.value ?? '')}`).join(' · ') : 'No conditions — every matching file qualifies.'}</p></div><div><p className="text-[11px] text-[var(--ledger-text-muted)]">Actions that would run</p><p className="mt-1 text-[var(--ledger-text-secondary)]">{rule.actions?.map((action) => labelFor(actions, action.type)).join(' · ') || 'No actions configured.'}</p></div></div><p className="mt-5 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--ledger-text-muted)]">Preview mode does not perform actions. A live execution will run only when this rule is enabled and a matching Drive change is received.</p><div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white">Done</button></div></div></ModalOverlay>;
}
