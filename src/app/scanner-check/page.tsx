import { notFound } from "next/navigation";
import ScannerCheck from "../../../tests/ScannerCheck";
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <ScannerCheck />;
}
