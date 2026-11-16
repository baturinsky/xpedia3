import { rul } from './Ruleset';
import { Article } from './Article';
import { last } from '../util';

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

  static all() {
    return [...rul.sectionsOrder, ...rul.sortedTypeSections()]
  }

  nearbySection(delta: number) {
    let as = Section.all();
    let ind = as.indexOf(this);
    let nextInd = (ind + delta + as.length) % as.length;
    return as[nextInd]
  }

  lastArticle(alphabetical: boolean) {
    return last(this.articles(alphabetical));
  }

  firstArticle(alphabetical: boolean) {
    return this.articles(alphabetical)[0];
  }
}
