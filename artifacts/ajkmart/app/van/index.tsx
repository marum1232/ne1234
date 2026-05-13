import { withServiceGuard } from "@/components/ServiceGuard";
import { withErrorBoundary } from "@/utils/withErrorBoundary";

export default withErrorBoundary(withServiceGuard("van", () => import("./_Screen")));
