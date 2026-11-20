import { sortFirstLast } from "../rul/Ruleset";
import { type AnyRef, LinksPage } from "./components";

/** Conditions article body, follows old `Conditions.svelte` */
export default function Conditions({ conditions }: { conditions: { [field: string]: unknown } }) {
  const sorted = sortFirstLast(conditions, { exclude: ["type"] });
  return (
    <>
      {sorted.all.map(([key, prop]) => (
        // The key goes through `LinksPage`, whose own `Val` translates it
        <LinksPage key={key} links={prop as AnyRef[]} title={key} />
      ))}
    </>
  );
}
