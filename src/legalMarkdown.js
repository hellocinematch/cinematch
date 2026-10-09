import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import privacyMd from "../Policies/PRIVACY_POLICY.md?raw";
import termsMd from "../Policies/TERMS_OF_SERVICE.md?raw";

/** GitHub-style heading ids so the policy TOC links (`#1-what-information-do-we-collect`) resolve. */
function legalHeadingSlug(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/** Fresh MarkdownIt per render so heading slug state does not leak between documents. */
function renderLegalMarkdown(src) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
  }).use(markdownItAnchor, { slugify: legalHeadingSlug });
  return md.render(src || "");
}

export const LEGAL_PRIVACY_HTML = renderLegalMarkdown(privacyMd);
export const LEGAL_TERMS_HTML = renderLegalMarkdown(termsMd);
