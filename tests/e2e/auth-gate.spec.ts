import { expect, test } from "@playwright/test";

test.describe("Auth gate", () => {
  test("/ redirige un visiteur non connecté vers /login", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    // Soit le middleware redirige côté serveur (307), soit le client suit
    // la redirection côté navigateur. Dans les 2 cas on doit finir sur /login.
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login/);
  });

  test("/login renvoie le formulaire email + mot de passe", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Connexion")).toBeVisible();
    await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
    await expect(page.getByLabel(/mot de passe/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /se connecter/i })).toBeVisible();
    // Toggle vers la création de compte.
    await expect(page.getByRole("button", { name: /créer un compte/i })).toBeVisible();
  });

  test("le middleware protège les routes applicatives", async ({ page }) => {
    const protectedPaths = ["/contacts", "/projets", "/opportunites", "/planning", "/notes"];
    for (const path of protectedPaths) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});
