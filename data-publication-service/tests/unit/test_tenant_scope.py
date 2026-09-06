import pytest

from publication.common.errors import CrossTenantSafetyError
from publication.lakehouse.tenant_scope import assert_cross_tenant_safety


def test_cross_tenant_safety_passes_for_single_tenant_rows():
    rows = [
        {"organization_id": "org-a", "tenant_id": "tenant-a"},
        {"organization_id": "org-a", "tenant_id": "tenant-a"},
    ]
    assert_cross_tenant_safety(rows, organization_id="org-a", tenant_id="tenant-a", org_col="organization_id", tenant_col="tenant_id")


def test_cross_tenant_safety_rejects_foreign_organization():
    rows = [
        {"organization_id": "org-a", "tenant_id": "tenant-a"},
        {"organization_id": "org-b", "tenant_id": "tenant-a"},
    ]
    with pytest.raises(CrossTenantSafetyError):
        assert_cross_tenant_safety(rows, organization_id="org-a", tenant_id="tenant-a", org_col="organization_id", tenant_col="tenant_id")


def test_cross_tenant_safety_rejects_foreign_tenant():
    rows = [{"organization_id": "org-a", "tenant_id": "tenant-b"}]
    with pytest.raises(CrossTenantSafetyError):
        assert_cross_tenant_safety(rows, organization_id="org-a", tenant_id="tenant-a", org_col="organization_id", tenant_col="tenant_id")


def test_cross_tenant_safety_allows_empty_rows():
    assert_cross_tenant_safety([], organization_id="org-a", tenant_id="tenant-a", org_col="organization_id", tenant_col="tenant_id")
