import { rul, sortFirstLast } from "../rul/Ruleset";
import { LinksPage } from "./components";

/** Conditions article body, follows old `Conditions.svelte` */
export default function Conditions({ conditions }: { conditions: any }) {
  let sorted = sortFirstLast(conditions, { exclude: ["type"] });
  return <>
    {sorted.all.map(([key, prop]) =>
      <LinksPage key={key} links={prop} title={rul.tr(key)} />
    )}
  </>;
}
