"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2, Users } from "lucide-react";
import type { Stakeholder } from "@/lib/db/schema";
import {
  createStakeholder,
  deleteStakeholder,
  logStakeholderContact,
  updateStakeholder,
} from "@/server/actions";
import { Card, CardTitle, Chip } from "./ui";

/**
 * People, editable where you actually look at them. The previous version put an
 * "Edit" link here that only navigated to Settings, which reads as broken —
 * and the contact cadence is worth nothing if resetting the clock is a chore.
 */
export function PeopleCard({ clientId, people }: { clientId: string; people: Stakeholder[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function run(fn: () => Promise<{ ok: boolean }>) {
    startTransition(async () => {
      await fn();
      setEditingId(null);
      setAdding(false);
      router.refresh();
    });
  }

  function form(person: Stakeholder | null) {
    return (
      <form
        action={(fd) => {
          const values = {
            name: String(fd.get("name") ?? ""),
            role: String(fd.get("role") ?? ""),
            email: String(fd.get("email") ?? ""),
            contactCadenceDays: Number(fd.get("cadence") ?? 0),
            receivesReports: fd.get("receivesReports") === "on",
          };
          run(() => (person ? updateStakeholder(person.id, values) : createStakeholder({ clientId, ...values })));
        }}
        className="flex flex-col gap-2 border-t py-3 first:border-t-0"
      >
        <div className="grid grid-cols-2 gap-2">
          <input name="name" defaultValue={person?.name} placeholder="Name" className="input py-1.5 text-[12.5px]" required autoFocus />
          <input name="role" defaultValue={person?.role ?? ""} placeholder="Role" className="input py-1.5 text-[12.5px]" />
          <input name="email" type="email" defaultValue={person?.email ?? ""} placeholder="Email" className="input py-1.5 text-[12.5px]" />
          <input
            name="cadence"
            type="number"
            min={0}
            defaultValue={person?.contactCadenceDays ?? 0}
            placeholder="Contact every N days"
            className="input py-1.5 text-[12.5px]"
            title="How often they should hear from you. 0 turns the reminder off."
          />
        </div>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" name="receivesReports" defaultChecked={person?.receivesReports} className="h-4 w-4" />
          Gets the reports
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setEditingId(null); setAdding(false); }} className="btn btn-sm">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="btn btn-sm btn-primary">
            {person ? "Save" : "Add"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <Card>
      <CardTitle
        action={
          !adding && (
            <button onClick={() => { setAdding(true); setEditingId(null); }} className="btn btn-ghost btn-sm">
              <Plus size={13} />
              Add
            </button>
          )
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Users size={12} />
          People
        </span>
      </CardTitle>

      {adding && form(null)}

      {people.length === 0 && !adding ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          No one recorded. Adding them with a contact cadence is what turns “I should check in” into something the system
          tells you.
        </p>
      ) : (
        <ul className="flex flex-col">
          {people.map((person) => {
            if (editingId === person.id) return <li key={person.id}>{form(person)}</li>;

            const since = person.lastContactAt
              ? Math.floor((Date.now() - person.lastContactAt.getTime()) / 86_400_000)
              : null;
            const overdue = person.contactCadenceDays > 0 && (since === null || since > person.contactCadenceDays);

            return (
              <li key={person.id} className="group flex items-center gap-2 rounded-[8px] px-1 py-1.5 hover:bg-[var(--raised)]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{person.name}</p>
                  <p className="truncate text-[11.5px] text-muted">
                    {person.role ?? "—"}
                    {person.contactCadenceDays > 0 &&
                      (since !== null ? ` · spoke ${since}d ago` : " · never contacted")}
                  </p>
                </div>

                {overdue && <Chip tone="warn" solid>due</Chip>}
                {person.receivesReports && <Chip tone="brand">reports</Chip>}

                {/* Always visible: a hover-only control group is unreachable on a phone. */}
                <div className="flex shrink-0 items-center gap-0.5">
                  {person.contactCadenceDays > 0 && (
                    <button
                      onClick={() => {
                        setJustLogged(person.id);
                        run(() => logStakeholderContact(person.id));
                        setTimeout(() => setJustLogged((id) => (id === person.id ? null : id)), 2200);
                      }}
                      className="btn btn-ghost btn-sm"
                      aria-label={`Log that you spoke to ${person.name} today`}
                      title="I spoke to them today — resets the clock"
                    >
                      {justLogged === person.id ? (
                        <span className="text-[11px] text-ok">noted</span>
                      ) : (
                        <Check size={12} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => { setEditingId(person.id); setAdding(false); }}
                    className="btn btn-ghost btn-sm"
                    aria-label={`Edit ${person.name}`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm(`Remove ${person.name}?`)) return;
                      run(() => deleteStakeholder(person.id));
                    }}
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove ${person.name}`}
                    title="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
