from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Assignment, Draw, Family, Household, Idea, Member, Reservation, User


@admin.register(User)
class NoelUserAdmin(UserAdmin):
    list_display = ("username", "email", "is_staff", "last_login")


class HouseholdInline(admin.TabularInline):
    model = Household
    extra = 0


class MemberInline(admin.TabularInline):
    model = Member
    extra = 0
    fields = ("name", "user", "household", "is_admin")


@admin.register(Family)
class FamilyAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "invite_code")
    inlines = [HouseholdInline, MemberInline]


@admin.register(Member)
class MemberAdmin(admin.ModelAdmin):
    list_display = ("name", "family", "user", "household", "is_admin")
    list_filter = ("family",)
    filter_horizontal = ("managers",)


@admin.register(Idea)
class IdeaAdmin(admin.ModelAdmin):
    list_display = ("title", "recipient", "author", "year", "archived")
    list_filter = ("year", "archived", "recipient__family")
    search_fields = ("title", "recipient__name")


@admin.register(Reservation)
class ReservationAdmin(admin.ModelAdmin):
    list_display = ("idea", "owner", "status")


class AssignmentInline(admin.TabularInline):
    model = Assignment
    extra = 0


@admin.register(Draw)
class DrawAdmin(admin.ModelAdmin):
    list_display = ("title", "family", "year")
    inlines = [AssignmentInline]
