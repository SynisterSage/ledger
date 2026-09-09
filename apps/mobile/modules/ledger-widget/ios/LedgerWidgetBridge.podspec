require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LedgerWidgetBridge'
  s.module_name    = 'LedgerWidgetBridge'
  s.version        = package['version']
  s.summary        = 'Ledger Today widget bridge'
  s.description    = 'Expo native module for publishing Ledger Today snapshots to WidgetKit.'
  s.author         = { 'Ledger' => 'engineering@ledgerworkspace.com' }
  s.homepage       = 'https://ledgerworkspace.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/ledgerworkspace/ledger.git' }
  s.static_framework = true
  s.dependency     'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
