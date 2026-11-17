import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { faqs } from "@/lib/site";

export function Faq() {
  return (
    <section id="faq" className="mx-auto grid grid-cols-1 w-full max-w-5xl scroll-mt-8 gap-8 px-6 py-20 md:grid-cols-2 md:py-32">
      <h2 className="text-4xl font-medium tracking-[-0.03em]">FAQs</h2>
      <Accordion defaultValue={[faqs[0].q]} className="border-t md:-mt-5 md:border-t-0">
        {faqs.map((item) => (
          <AccordionItem key={item.q} value={item.q} className="border-b not-last:border-b">
            <AccordionTrigger>{item.q}</AccordionTrigger>
            <AccordionContent className="pr-10 text-muted-foreground">
              <p>{item.a}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
