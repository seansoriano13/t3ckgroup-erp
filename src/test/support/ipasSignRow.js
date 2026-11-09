import { screen, waitFor, within } from "@testing-library/react";

/**
 * A sign-off is only pointed to from the rail ("Go to sign-off", #938/#939); it is signed from
 * its own row in 6 · Sign-offs, whose Sign button opens the review window. This does both
 * presses and leaves the review window open.
 */
export async function openSignReview(user, key) {
  const region = await screen.findByRole("region", { name: "Your move" });
  const item = await within(region).findByTestId(`ipas-journey-${key}`);
  await user.click(within(item).getByRole("button", { name: "Go to sign-off" }));
  await waitFor(() => expect(document.getElementById(`ipas-signoff-${key}`)).not.toBeNull());
  await user.click(within(document.getElementById(`ipas-signoff-${key}`)).getByRole("button", { name: "Sign" }));
}
