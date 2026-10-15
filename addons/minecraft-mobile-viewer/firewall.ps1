param([switch]$Remove, [switch]$SetHomeWifi)
$ErrorActionPreference = 'Stop'
if ($SetHomeWifi) { Set-NetConnectionProfile -InterfaceAlias WLAN -NetworkCategory Private }
$rules = @(
    @{Name='CortiMobile-Read'; Port='7898'; Protocol='TCP'},
    @{Name='CortiMobile-ICE-TCP'; Port='8199'; Protocol='TCP'},
    @{Name='CortiMobile-ICE-UDP'; Port='8199'; Protocol='UDP'}
)
foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue
    if ($Remove) {
        if ($existing) { $existing | Remove-NetFirewallRule }
        continue
    }
    if ($existing) { $existing | Remove-NetFirewallRule }
    New-NetFirewallRule -Name $rule.Name -DisplayName $rule.Name -Direction Inbound -Action Allow -Profile Private -RemoteAddress LocalSubnet -Protocol $rule.Protocol -LocalPort $rule.Port | Out-Null
}
Write-Output 'CortiMobile firewall rules updated (Private / LocalSubnet only).'
