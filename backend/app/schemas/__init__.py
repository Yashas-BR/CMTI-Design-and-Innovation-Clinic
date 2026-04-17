"""Pydantic schemas for request/response validation."""

from .auth import (
	CreateDriverRequest,
	LoginRequest,
	LoginResponse,
	TokenRefreshRequest,
	UserSummaryResponse,
)
from .alerts import (
	AlertActionRequest,
	AlertAssignRequest,
	AlertEventListResponse,
	AlertEventResponse,
	AlertListResponse,
	AlertResponse,
)
from .bin import BinCreateRequest, BinListResponse, BinResponse, BinSearchResponse, BinUpdateRequest
from .device import (
	AssignmentCreateRequest,
	AssignmentHistoryItem,
	AssignmentHistoryResponse,
	DeviceCreateRequest,
	DeviceListResponse,
	DeviceResponse,
	DeviceUpdateRequest,
)
from .health import HealthResponse
from .mqtt import (
	MQTTIngestRequest,
	MQTTIngestResponse,
	TelemetryHistoryResponse,
	TelemetryLatestResponse,
	TelemetryLiveSummaryResponse,
	TelemetryPoint,
)
from .operations_assignment import (
	RouteAssignmentCreateRequest,
	RouteAssignmentListResponse,
	RouteAssignmentRejectRequest,
	RouteAssignmentResponse,
)
from .operations_route import (
	RouteDraftCreateRequest,
	RouteListResponse,
	RoutePlanRequest,
	RoutePlanResponse,
	RoutePlanStopResponse,
	RoutePublishRequest,
	RouteResponse,
	StartPointResponse,
)
from .operations_shift import ShiftCreateRequest, ShiftListResponse, ShiftResponse
from .operations_stop import (
	RouteStopListResponse,
	RouteStopResponse,
	StopArriveRequest,
	StopServiceRequest,
	StopSkipRequest,
)
from .operations_vehicle import VehicleCreateRequest, VehicleListResponse, VehicleResponse, VehicleUpdateRequest
from .users import UserListResponse, UserPasswordResetRequest, UserResponse, UserRoleMutationRequest

__all__ = [
	"HealthResponse",
	"LoginRequest",
	"TokenRefreshRequest",
	"LoginResponse",
	"CreateDriverRequest",
	"UserSummaryResponse",
	"UserRoleMutationRequest",
	"UserPasswordResetRequest",
	"UserResponse",
	"UserListResponse",
	"AlertActionRequest",
	"AlertAssignRequest",
	"AlertResponse",
	"AlertListResponse",
	"AlertEventResponse",
	"AlertEventListResponse",
	"BinCreateRequest",
	"BinUpdateRequest",
	"BinResponse",
	"BinListResponse",
	"BinSearchResponse",
	"DeviceCreateRequest",
	"DeviceUpdateRequest",
	"DeviceResponse",
	"DeviceListResponse",
	"AssignmentCreateRequest",
	"AssignmentHistoryItem",
	"AssignmentHistoryResponse",
	"MQTTIngestRequest",
	"MQTTIngestResponse",
	"TelemetryPoint",
	"TelemetryLatestResponse",
	"TelemetryHistoryResponse",
	"TelemetryLiveSummaryResponse",
	"VehicleCreateRequest",
	"VehicleUpdateRequest",
	"VehicleResponse",
	"VehicleListResponse",
	"ShiftCreateRequest",
	"ShiftResponse",
	"ShiftListResponse",
	"RoutePlanRequest",
	"RoutePlanStopResponse",
	"RoutePlanResponse",
	"RouteDraftCreateRequest",
	"RoutePublishRequest",
	"StartPointResponse",
	"RouteResponse",
	"RouteListResponse",
	"RouteAssignmentCreateRequest",
	"RouteAssignmentRejectRequest",
	"RouteAssignmentResponse",
	"RouteAssignmentListResponse",
	"StopArriveRequest",
	"StopServiceRequest",
	"StopSkipRequest",
	"RouteStopResponse",
	"RouteStopListResponse",
]
