import { useMySorWork } from "./useMySorWork";

/** The SORS register's My work view on its own, toolbar above the list. */
export default function MySorWork() {
  const { toolbar, body } = useMySorWork();
  return (
    <>
      {toolbar}
      {body}
    </>
  );
}
