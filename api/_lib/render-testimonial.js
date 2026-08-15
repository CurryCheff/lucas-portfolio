// Renders approved testimonials into the exact .testimonial markup shape
// already defined in style.css, and splices them into index.html between
// marker comments.
//
// SECURITY BOUNDARY (security-patterns.md rule 7): this file reads ONLY
// `quote`, `authorName`, `authorRole` from a submission row. It must never
// receive or touch the Gemini-drafted thank-you text — that text is a
// separate, one-way output to email/WhatsApp (see notify-thankyou.js) and
// has no code path back into what this file produces. If a future change
// makes this file accept anything resembling "AI-drafted" or "generated"
// text as content to publish, that's the bug this comment exists to catch
// in review.

const START_MARKER = '<!-- TESTIMONIALS:START -->';
const END_MARKER = '<!-- TESTIMONIALS:END -->';

// Escape order matters: & first, or subsequent replacements get double-escaped.
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function renderTestimonialCard(row) {
  const quote = escapeHtml(row.quote);
  const name = escapeHtml(row.author_name);
  const role = escapeHtml(row.author_role);
  return `      <div class="testimonial" data-anim="fade-up">
        <div class="testimonial__quote-mark">&ldquo;</div>
        <p class="testimonial__quote">${quote}</p>
        <div class="testimonial__author">
          <div class="testimonial__avatar">${escapeHtml(initials(row.author_name))}</div>
          <div>
            <span class="testimonial__name">${name}</span>
            <span class="testimonial__role">${role}</span>
          </div>
        </div>
      </div>`;
}

function renderTrack(rows) {
  return rows.map(renderTestimonialCard).join('\n');
}

// Splices `innerHtml` between the marker comments in `html`. Fails closed:
// throws if the markers aren't found exactly once each, in order — no
// partial/malformed write is ever produced. Existing content between the
// markers (from a previous publish) is replaced wholesale each time, so
// this always writes the full current set of published testimonials, not
// just the newly-added ones.
function spliceTestimonials(html, innerHtml) {
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('TESTIMONIALS markers not found in index.html — refusing to write');
  }
  if (html.indexOf(START_MARKER, startIdx + 1) !== -1 || html.indexOf(END_MARKER, endIdx + 1) !== -1) {
    throw new Error('TESTIMONIALS markers appear more than once in index.html — refusing to write');
  }
  if (endIdx < startIdx) {
    throw new Error('TESTIMONIALS:END appears before TESTIMONIALS:START — refusing to write');
  }

  const before = html.slice(0, startIdx + START_MARKER.length);
  const after = html.slice(endIdx);

  return `${before}\n  <section class="testimonials" id="testimonials">\n    <div class="testimonials__track" id="testimonialsTrack">\n${innerHtml}\n    </div>\n  </section>\n  ${after}`;
}

module.exports = { escapeHtml, renderTestimonialCard, renderTrack, spliceTestimonials, START_MARKER, END_MARKER };
