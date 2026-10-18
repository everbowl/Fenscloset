import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import type { ExtraField } from "@/lib/lists/registry";

/** Extra inputs (swatch, website) for kinds that have them. Shared by the editor and InlineAdd. */
export function EntryExtraFields({ fields, values, onChange }: {
  fields: ExtraField[];
  values: { hex?: string; url?: string | null; unit?: string };
  onChange: (patch: { hex?: string; url?: string; unit?: string }) => void;
}) {
  return (
    <>
      {fields.map((f) =>
        f.type === "color" ? (
          <Field key={f.name} label={f.label} htmlFor={`field-${f.name}`}>
            <div className="flex items-center gap-3">
              <input
                id={`field-${f.name}`}
                type="color"
                value={values.hex ?? "#888888"}
                onChange={(e) => onChange({ hex: e.target.value })}
                className="size-9 cursor-pointer border border-line bg-paper p-0.5"
              />
              <Input value={values.hex ?? ""} onChange={(e) => onChange({ hex: e.target.value })} placeholder="#RRGGBB" className="font-mono" />
            </div>
          </Field>
        ) : f.type === "text" ? (
          <Field key={f.name} label={f.label} htmlFor={`field-${f.name}`}>
            <Input id={`field-${f.name}`} value={values.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} placeholder={f.placeholder} maxLength={12} />
          </Field>
        ) : (
          <Field key={f.name} label={f.label} htmlFor={`field-${f.name}`}>
            <Input id={`field-${f.name}`} type="url" inputMode="url" value={values.url ?? ""} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://" />
          </Field>
        ),
      )}
    </>
  );
}
