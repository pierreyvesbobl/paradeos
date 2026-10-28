import { describe, expect, it } from "vitest";
import { isCalendarMail } from "./calendar-mail";

describe("isCalendarMail", () => {
  it("reconnaît les rappels et invitations Google Agenda", () => {
    expect(
      isCalendarMail({
        fromEmail: "calendar-notification@google.com",
        subject: "Notification: Faire les volets sociaux - mar. 25 août 2026 11:00",
      }),
    ).toBe(true);
    expect(
      isCalendarMail({
        fromEmail: "benjamin@rocketlinks.net",
        subject: "Invitation: Rocketlinks Démo - mer. 16 sept. 2026 14:00 - 14:30 (UTC+2)",
      }),
    ).toBe(true);
    expect(
      isCalendarMail({
        fromEmail: "benilde@gmail.com",
        subject: "Invitation mise à jour: Parade Monthly - mar. 1 sept. 2026",
      }),
    ).toBe(true);
    expect(
      isCalendarMail({ fromEmail: "a.eric@gpasplus.com", subject: "Accepté : Eric et PY" }),
    ).toBe(true);
    expect(
      isCalendarMail({ fromEmail: "jcd@gmail.com", subject: "Declined: Benoit / JC @ Wed" }),
    ).toBe(true);
  });

  it("reconnaît les confirmations et annulations de rendez-vous des outils de prise de RDV", () => {
    expect(
      isCalendarMail({
        fromEmail: "hello@cal.com",
        subject: "Rendez-vous de 30 min between Pierre-Yves Sage and mamura",
      }),
    ).toBe(true);
    expect(
      isCalendarMail({
        fromEmail: "hello@cal.com",
        subject: "Canceled: Rendez-vous de 30 min between Pierre-Yves Sage and test",
      }),
    ).toBe(true);
  });

  it("laisse passer le marketing des mêmes outils et les autres notifications", () => {
    expect(
      isCalendarMail({
        fromEmail: "updates@cal.com",
        subject: "Changelog: Cal.com v6.9 - Workflows",
      }),
    ).toBe(false);
    expect(isCalendarMail({ fromEmail: "bailey@cal.com", subject: "A month in" })).toBe(false);
    expect(
      isCalendarMail({
        fromEmail: "meetings-noreply@google.com",
        subject: 'Enregistrements de réunion : "Amaury x PY" 15 sept. 2026',
      }),
    ).toBe(false);
    expect(
      isCalendarMail({ fromEmail: "notifications@stripe.com", subject: "Votre reçu Stripe" }),
    ).toBe(false);
    expect(isCalendarMail({ fromEmail: null, subject: null })).toBe(false);
  });
});
