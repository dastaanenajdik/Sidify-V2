import { serializeJsonLd } from "@/lib/seo";

/**
 * Renders Schema.org structured data for Google & search engines, escaping `<`
 * so embedded strings can never break out of the `<script>` tag.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
