"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { accessEndpoint, site } from "@/lib/site";

type Status = "idle" | "sending" | "sent" | "error";

const topics = [
  { value: "access", label: "Early access for my product" },
  { value: "sales", label: "Talking to sales" },
  { value: "other", label: "Something else" },
] as const;

/** The form on the contact page. `?topic=sales` opens it on the sales option. */
export function ContactForm() {
  const asked = useSearchParams().get("topic");
  const initial = topics.some((topic) => topic.value === asked) ? asked! : "access";
  return <Form key={initial} initialTopic={initial} />;
}

/** What shows while the address bar is being read. Same form, default topic. */
export function ContactFormFallback() {
  return <Form initialTopic="access" />;
}

function Form({ initialTopic }: { initialTopic: string }) {
  const [topic, setTopic] = useState(initialTopic);
  const [status, setStatus] = useState<Status>("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setStatus("sending");
    try {
      const response = await fetch(accessEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), company: data.get("company"), topic }),
      });
      setStatus(response.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-8">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-balance">
        {topic === "sales" ? "Talk to our team about Haptic" : "Request access to Haptic"}
      </h2>
      {status === "sent" ? (
        <p role="status" className="mt-6 rounded-xl bg-muted px-4 py-3 text-base">
          Thanks. We have your details and will be in touch soon.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="contact-email">Work email</Label>
            <Input id="contact-email" name="email" type="email" required autoComplete="email" placeholder="jane@acme.co" className="h-11 px-3.5 md:text-base" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contact-company">Company</Label>
            <Input id="contact-company" name="company" type="text" autoComplete="organization" placeholder="Acme" className="h-11 px-3.5 md:text-base" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contact-topic">What can we help you with</Label>
            <NativeSelect
              id="contact-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="w-full [&_select]:h-11 [&_select]:pl-3.5 [&_select]:text-base [&_svg]:right-3.5"
            >
              {topics.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {status === "error" && (
            <p role="alert" className="text-sm text-destructive">
              That did not go through. Email {site.email} and we will set you up.
            </p>
          )}
          <Button type="submit" size="xl" disabled={status === "sending"} className="self-start">
            {status === "sending" ? "Sending" : "Continue"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </form>
      )}
    </div>
  );
}
