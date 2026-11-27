import React, { useEffect, useState } from "react";
import { Check, CheckSquare, Plus, Send, Square } from "lucide-react";
import { fetchChecklist, saveChecklist, type ChecklistItemDto } from "../lib/hermesApi";
import type { DetectedChecklist } from "../lib/secretDetection";

interface InteractiveChecklistCardProps {
  checklist: DetectedChecklist;
  onSendStatus?: (summary: string) => void;
}

export const InteractiveChecklistCard: React.FC<InteractiveChecklistCardProps> = ({
  checklist,
  onSendStatus,
}) => {
  const [items, setItems] = useState<ChecklistItemDto[]>(checklist.items);
  const [newItemText, setNewItemText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchChecklist(checklist.id).then((stored) => {
      if (cancelled || !stored) return;
      // Merge server checked states with any newly added items from the bot message
      const storedMap = new Map(stored.items.map((i) => [i.text.toLowerCase(), i.checked]));
      const merged = checklist.items.map((i) => ({
        text: i.text,
        checked: storedMap.has(i.text.toLowerCase()) ? storedMap.get(i.text.toLowerCase())! : i.checked,
      }));
      // Also preserve user-added items stored on server
      const botSet = new Set(checklist.items.map((i) => i.text.toLowerCase()));
      for (const extra of stored.items) {
        if (!botSet.has(extra.text.toLowerCase())) {
          merged.push(extra);
        }
      }
      setItems(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [checklist.id, checklist.items]);

  const persist = async (next: ChecklistItemDto[]) => {
    setItems(next);
    setSaving(true);
    try {
      await saveChecklist(checklist.id, checklist.title, next);
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  };

  const toggleIndex = (idx: number) => {
    const next = items.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it));
    void persist(next);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newItemText.trim();
    if (!clean) return;
    setNewItemText("");
    void persist([...items, { text: clean, checked: false }]);
  };

  const doneCount = items.filter((i) => i.checked).length;

  return (
    <div className="checklist-card" aria-label={`Checkliste: ${checklist.title}`}>
      <div className="checklist-header">
        <div className="checklist-title-wrap">
          <CheckSquare size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span className="checklist-title">{checklist.title}</span>
        </div>
        <span className="checklist-progress">
          {doneCount}/{items.length} {saving ? "· …" : ""}
        </span>
      </div>

      <div className="checklist-items">
        {items.map((item, idx) => (
          <button
            key={`${item.text}-${idx}`}
            type="button"
            className={`checklist-item${item.checked ? " done" : ""}`}
            onClick={() => toggleIndex(idx)}
          >
            {item.checked ? (
              <Check size={15} className="checklist-check-icon done" />
            ) : (
              <Square size={15} className="checklist-check-icon" />
            )}
            <span>{item.text}</span>
          </button>
        ))}
      </div>

      <form className="checklist-add-row" onSubmit={handleAdd}>
        <input
          type="text"
          className="checklist-add-input"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          placeholder="Punkt hinzufügen…"
        />
        <button
          type="submit"
          className="icon-btn ghost"
          aria-label="Punkt hinzufügen"
          disabled={!newItemText.trim()}
        >
          <Plus size={15} />
        </button>
      </form>

      {onSendStatus && (
        <div className="checklist-footer">
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              const done = items.filter((i) => i.checked).map((i) => i.text);
              const open = items.filter((i) => !i.checked).map((i) => i.text);
              const lines = [`Aktueller Stand „${checklist.title}“`];
              if (done.length > 0) lines.push(`Erledigt: ${done.join(", ")}`);
              if (open.length > 0) lines.push(`Noch offen: ${open.join(", ")}`);
              onSendStatus(lines.join("\n"));
            }}
          >
            <Send size={12} /> Stand an Bot senden
          </button>
        </div>
      )}
    </div>
  );
};
