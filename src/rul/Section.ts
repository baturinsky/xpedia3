import { rul } from './Ruleset';
import { Article } from './Article';

export class Section {
  _articles: Article[] = [];

  /**
   * The alphabetical order, cached per language.
   *
   * Sorting compares *translated* titles, so the result is a different order in
   * every language: `en-US` and `ru` put entirely different articles first. It
   * is also far from cheap — the 2904-article `RESEARCH` section takes ~90 ms,
   * because every comparison re-runs `tr()` on both ids and the comparator is a
   * `localeCompare` with numeric collation.
   *
   * The order only changes when the article list or the language does, which is
   * why this is keyed on the language rather than cleared by hand: switching to
   * a language that was already sorted reuses its order, and switching back
   * does not have to sort again. `_articles` is only appended to, and only while
   * a pack is being loaded, so a cached length is enough to tell whether the
   * cached order is still current — rebuilding beats tracking every `add()`.
   */
  _sorted: { [langName: string]: { articles: Article[], count: number } } = {};

  articles(alphabetical = false) {
    if (!alphabetical)
      return this._articles;

    let langName = rul.langName ?? "";
    let cached = this._sorted[langName];
    // A section with no cache for this language, or one whose article list has
    // grown since the sort, has to be sorted again
    if (!cached || cached.count != this._articles.length)
      cached = this._sorted[langName] = {
        articles: rul.sortArticlesByName(this._articles),
        count: this._articles.length,
      };
    return cached.articles;
  }

  constructor(public id: string, xpediaOwn = false) {
    rul.sections[id] = this;

    if (xpediaOwn) {
      rul.typeSectionsOrder.push(this);
    } else {
      rul.sectionsOrder.push(this);
    }

    // A section page shows the pack's own article for that id (pedia text and
    // illustration) above the article list. Only fall back to an empty stub
    // when no such article exists.
    Article.create(id, id);
  }

  get title() {
    return rul.tr(this.id);
  }

  add(article: Article) {
    if (!this._articles.includes(article)) this._articles.push(article);
    if (!article.sections.includes(this)) article.sections.push(this);
  }

  static all(alphabetical = false) {
    return rul.sectionOrder(alphabetical);
  }

  /**
   * The section `<`/`>` steps into when it runs off this one's article list.
   *
   * Sections with no articles are skipped, whether or not they have a page of
   * their own: a pack can declare a type table and ship no entries, and an empty
   * list is a dead end for the arrows. The walk wraps, so running off the last
   * category lands on the first section with articles and the other way round.
   * Returns `this` when no other section has an article, which the caller reads
   * as "there is nowhere to go".
   *
   * `alphabetical` only decides the order of the *categories*; the pedia's own
   * sections keep the pack's order either way. See `Ruleset.sectionOrder`.
   */
  adjacentSection(delta: number, alphabetical = false) {
    let as = Section.all(alphabetical);
    let ind = as.indexOf(this);
    for (let step = 1; step <= as.length; step++) {
      let next = as[(((ind + delta * step) % as.length) + as.length) % as.length];
      if (next.articles(alphabetical).length)
        return next;
    }
    return this;
  }
}
