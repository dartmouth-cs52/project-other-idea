import { signUp } from "../actions";
import { AuthForm } from "../AuthForm";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}
