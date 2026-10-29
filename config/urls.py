from django.contrib import admin
from django.urls import include, path

admin.site.site_header = "Cadeaux de Noël — administration"
admin.site.site_title = "Cadeaux de Noël"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("noel.urls")),
]
