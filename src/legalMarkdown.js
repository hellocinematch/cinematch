import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import privacyMd from "../Policies/PRIVACY_POLICY.md?raw";
import termsMd from "../Policies/TERMS_OF_SERVICE.md?raw";

/** Fresh MarkdownIt per render so heading slug state does not leak between documents. */
function renderLegalMarkdown(src) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
  }).use(markdownItAnchor);
  return md.render(src || "");
}

export const LEGAL_PRIVACY_HTML = renderLegalMarkdown(privacyMd);
export const LEGAL_TERMS_HTML = renderLegalMarkdown(termsMd);
