export function canShowAdminTab(ready: boolean, userId: string | undefined, access: boolean | undefined) {
  return ready && !!userId && access === true;
}