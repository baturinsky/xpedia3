import { Fragment, type ReactNode } from "react";
import type { MainTableRenderer } from "./MainTable";
import { formatNumber, TipScopeProvider, Val } from "./Val";

/**
 * The map-script commands of one `mapScripts` entry, in execution order.
 *
 * A `commands` list is a program: the engine runs it top to bottom, and a
 * `conditionals` value refers to commands by the `label` they carry. An
 * indexed table (`0`, `1`, `2`, …) hides the order behind row numbers that
 * mean nothing, and a nested `MainTable` per command repeats the field names
 * in a box inside a box. An ordered list keeps the order, a code headline
 * keeps the rul spelling of the command, and a definition list per command
 * keeps one row per field without the table chrome.
 */

type MapScriptCommand = { [field: string]: unknown };

/**
 * Fields in the order they are read, rather than the order the pack happened
 * to write them in. `type` is the headline and never a row; anything the
 * engine knows about that is not listed here follows in sorted order, so a
 * field added by a future engine still has somewhere to go.
 */
const FIELD_ORDER = [
  "label",
  "conditionals",
  "direction",
  "size",
  "groups",
  "blocks",
  "freqs",
  "maxUses",
  "rects",
  "executionChances",
  "executions",
  "verticalGroup",
  "horizontalGroup",
  "crossingGroup",
  "craftGroups",
  "UFOName",
  "craftName",
  "terrain",
  "randomTerrain",
  "canBeSkipped",
  "markAsReinforcementsBlock",
  "tunnelData",
  "verticalLevels",
];

/** A command's fields in reading order, with the headline taken out */
function orderedFields(command: MapScriptCommand): [string, unknown][] {
  const known: [string, unknown][] = [];
  for (const field of FIELD_ORDER) {
    if (field in command) known.push([field, command[field]]);
  }
  const unknown = Object.keys(command)
    .filter((field) => field !== "type" && !FIELD_ORDER.includes(field))
    .sort();
  return [...known, ...unknown.map((field): [string, unknown] => [field, command[field]])];
}

/**
 * Whether a field says nothing the reader needs.
 *
 * `executionChances: 100` and `executions: 1` are the engine defaults, as are
 * `canBeSkipped: true` and `markAsReinforcementsBlock: false`, so stating
 * them again adds a line without adding a fact — the same rule the mission
 * script odds use. Any other value, including `executionChances: 0` (never
 * runs) and `canBeSkipped: false` (cannot be skipped), is shown.
 */
function isDefault(field: string, value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (field === "executionChances" && Number(value) === 100) return true;
  if (field === "executions" && Number(value) === 1) return true;
  if (field === "canBeSkipped" && value === true) return true;
  if (field === "markAsReinforcementsBlock" && value === false) return true;
  return false;
}

/** A scalar or a one-value list, as a list — groups and friends take both */
function asItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** A comma list of `Val`s, for the parallel `groups`/`blocks`/`freqs` lists */
function InlineList({ items, field }: { items: unknown[]; field?: string }): ReactNode {
  return (
    <>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a position in a parallel list identifies the item for the file reader
        <Fragment key={i}>
          {i > 0 && ", "}
          <Val of={item} field={field} />
        </Fragment>
      ))}
    </>
  );
}

/** The `[x, y, w, h]` rectangles a command applies to */
function Rects({ value }: { value: unknown }): ReactNode {
  const rects = asItems(value);
  return (
    <>
      {rects.map((rect, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a rectangle is identified by its position among the command's rects
        <Fragment key={i}>
          {i > 0 && "; "}
          <code>[{asItems(rect).map(formatNumber).join(", ")}]</code>
        </Fragment>
      ))}
    </>
  );
}

/** `size` as the dimensions it blocks, scalar or `[x, y, z]` */
function Size({ value }: { value: unknown }): ReactNode {
  if (!Array.isArray(value)) return <Val of={value} />;
  return <>{value.map(formatNumber).join("×")}</>;
}

/** One `MCDReplacements` entry of a `tunnelData` block */
function McdReplacement({ entry }: { entry: MapScriptCommand }): ReactNode {
  return (
    <>
      {/* The overlay name is rul text, matched against the file by eye */}
      <code>{String(entry.type ?? "")}</code>
      {entry.set != null && (
        <>
          {" "}
          <Val of="set" />: <Val of={entry.set} />
        </>
      )}
      {entry.entry != null && (
        <>
          {" "}
          <Val of="entry" />: <Val of={entry.entry} />
        </>
      )}
    </>
  );
}

/** `tunnelData`: the level dug and the wall tiles swapped in for it */
function TunnelData({ value }: { value: unknown }): ReactNode {
  const data = value as MapScriptCommand;
  const replacements = asItems(data.MCDReplacements ?? []).filter(
    (item): item is MapScriptCommand => typeof item === "object" && item != null,
  );
  return (
    <ul className="mapscript-nested">
      {data.level != null && (
        <li>
          <Val of="level" />: <Val of={data.level} />
        </li>
      )}
      {replacements.length > 0 && (
        <li>
          <Val of="MCDReplacements" />
          <ul className="mapscript-nested">
            {replacements.map((entry, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a replacement is identified by its position among its siblings
              <li key={i}>
                <McdReplacement entry={entry} />
              </li>
            ))}
          </ul>
        </li>
      )}
    </ul>
  );
}

/** One `verticalLevels` entry, as the level and what fills it */
function VerticalLevel({ level }: { level: MapScriptCommand }): ReactNode {
  const fields: [string, unknown][] = [];
  if (level.size != null) fields.push(["size", level.size]);
  if (level.groups != null) fields.push(["groups", level.groups]);
  if (level.blocks != null) fields.push(["blocks", level.blocks]);
  if (level.maxRepeats != null) fields.push(["maxRepeats", level.maxRepeats]);
  if (level.terrain != null) fields.push(["terrain", level.terrain]);
  return (
    <>
      {/* The level name is rul text, matched against the file by eye */}
      <code>{String(level.type ?? "")}</code>
      {fields.map(([field, fieldValue]) => (
        <Fragment key={field}>
          {field === "size" ? (
            <>
              {" "}
              <Val of="size" />: <Size value={fieldValue} />
            </>
          ) : field === "groups" || field === "blocks" ? (
            <>
              {" "}
              <Val of={field} />: <InlineList items={asItems(fieldValue)} field={field} />
            </>
          ) : (
            <>
              {" "}
              <Val of={field} />: <Val of={fieldValue} field={field} />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

/** `verticalLevels`: the ground, middle and ceiling of one block */
function VerticalLevels({ value }: { value: unknown }): ReactNode {
  const levels = asItems(value).filter(
    (item): item is MapScriptCommand => typeof item === "object" && item != null,
  );
  return (
    <ul className="mapscript-nested">
      {levels.map((level, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a level is identified by its position among its siblings
        <li key={i}>
          <VerticalLevel level={level} />
        </li>
      ))}
    </ul>
  );
}

/** One field's value as it reads: signs kept, percents marked, references linked */
function FieldValue({ field, value }: { field: string; value: unknown }): ReactNode {
  if (field === "rects" || field === "verticalLevels" || field === "tunnelData") {
    if (field === "rects") return <Rects value={value} />;
    if (field === "verticalLevels") return <VerticalLevels value={value} />;
    return <TunnelData value={value} />;
  }
  if (field === "size") return <Size value={value} />;
  if (field === "executionChances") return <em className="num">{formatNumber(value)}%</em>;
  if (
    field === "conditionals" ||
    field === "groups" ||
    field === "blocks" ||
    field === "freqs" ||
    field === "maxUses" ||
    field === "craftGroups" ||
    field === "randomTerrain"
  ) {
    return <InlineList items={asItems(value)} field={field} />;
  }
  return <Val of={value} field={field} />;
}

/** One command: its type as the headline, the rest as a definition list */
function MapScriptCommandView({ command }: { command: MapScriptCommand }): ReactNode {
  const type = command.type;
  const fields = orderedFields(command).filter(([field, value]) => !isDefault(field, value));
  return (
    <>
      {type != null && type !== "" && <code className="mapscript-type">{String(type)}</code>}
      {fields.length > 0 && (
        <dl className="mapscript-fields">
          {fields.map(([field, value]) => (
            <Fragment key={field}>
              <dt>
                <Val of={field} capital={true} />
              </dt>
              <dd>
                <FieldValue field={field} value={value} />
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </>
  );
}

function MapScriptCommandsView({ commands }: { commands: unknown }): ReactNode {
  const list = asItems(commands).filter((item) => item != null);
  if (list.length === 0) return null;
  return (
    <TipScopeProvider scope="mapScriptCommand">
      <ol className="mapscript-commands">
        {list.map((command, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a command is identified by its execution position, the number the list prints
          <li key={i}>
            {typeof command === "object" && command != null ? (
              <MapScriptCommandView command={command as MapScriptCommand} />
            ) : (
              <code>{String(command)}</code>
            )}
          </li>
        ))}
      </ol>
    </TipScopeProvider>
  );
}

/** The `commands` renderer for `mapScripts` articles */
export const mapScriptCommands: MainTableRenderer = ({ val }) => (
  <MapScriptCommandsView commands={val} />
);
