import { useParams } from "react-router";
import VerifiedRecordPreview from "@/components/verify/VerifiedRecordPreview";

export default function VerifyPage() {
  const { token } = useParams();
  
  return <VerifiedRecordPreview token={token} standalone={true} />;
}
